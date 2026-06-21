"""Encrypted export and import of an entire tree, plus GEDCOM import/export.

Encrypted exports are always encrypted at rest; a user password is optional.
GEDCOM exports produce a plain-text GEDCOM 5.5.1 file.
Imports (both formats) always land in a brand new tree owned by the importing
user, with every id remapped so re-importing never collides with existing data.
"""

from pathlib import Path
from uuid import uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree, require_feature
from app.core.config import settings
from app.db.base import utcnow_iso
from app.db.session import SessionLocal, get_db
from app.models import (
    Citation,
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    RelationType,
    Source,
    SourceEvidence,
    Story,
    StoryAttachment,
    StoryMemberLink,
    Tree,
    User,
)
from app.schemas.job import JobStarted
from app.services import crypto_export, gedcom
from app.services.job_service import ProgressCallback, create_job, run_job
from app.services.settings_service import get_media_limits
from app.services.storage import (
    delete_tree_media,
    media_url_to_data_url,
    process_image_field,
    store_document,
)
from app.services.storage_usage import QuotaExceeded, check_full_usage_quota

router = APIRouter(prefix="/trees", tags=["export"])

BUNDLE_VERSION = 2


def migrate_bundle(bundle: dict) -> dict:
    """Bring an older bundle up to BUNDLE_VERSION.

    Add a migration step here and bump BUNDLE_VERSION when the bundle schema
    changes.  Pre-first-release the ladder is empty; the scaffolding is in
    place so the first real migration is easy to add.
    """
    return bundle


def _validate_and_migrate(bundle: dict) -> dict:
    version = bundle.get("version", 1)
    if version > BUNDLE_VERSION:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This file was created by a newer version of the app "
                f"(bundle v{version}). Please update before importing."
            ),
        )
    return migrate_bundle(bundle)


def _rows(db: Session, model, tree_id: str) -> list[dict]:
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(select(model).where(model.tree_id == tree_id)).all()
    cols = [c.key for c in sa_inspect(model).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


@router.get("/{tree_id}/export")
def export_tree(
    password: str | None = None,
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    members = _rows(db, Member, tree.id)
    for m in members:
        m["image_data"] = media_url_to_data_url(m.get("image_data"))
    gallery = _rows(db, GalleryImage, tree.id)
    for g in gallery:
        g["image_data"] = media_url_to_data_url(g.get("image_data"))
    story_attachments = _rows(db, StoryAttachment, tree.id)
    for a in story_attachments:
        a["url"] = media_url_to_data_url(a.get("url"))

    source_evidence = _rows(db, SourceEvidence, tree.id)
    for ev in source_evidence:
        if ev.get("kind") == "file":
            ev["url"] = media_url_to_data_url(ev.get("url"))

    bundle = {
        "version": BUNDLE_VERSION,
        "app_version": settings.APP_VERSION,
        "exported_at": utcnow_iso(),
        "tree": {"name": tree.name, "created_at": tree.created_at},
        "members": members,
        "relations": _rows(db, Relation, tree.id),
        # The registry is instance-wide; bundle it so an import on another
        # instance can register any types it does not know yet.
        "relation_types": [
            {"id": rt.id, "description": rt.description}
            for rt in db.scalars(select(RelationType))
        ],
        "diseases": _rows(db, MemberDisease, tree.id),
        "gallery_images": gallery,
        "gallery_links": _link_rows(db, GalleryMemberLink, GalleryImage, tree.id),
        "events": _rows(db, Event, tree.id),
        "event_links": _link_rows(db, EventMemberLink, Event, tree.id),
        "stories": _rows(db, Story, tree.id),
        "story_links": _link_rows(db, StoryMemberLink, Story, tree.id),
        "story_attachments": story_attachments,
        "sources": _rows(db, Source, tree.id),
        "source_evidence": source_evidence,
        "citations": _rows(db, Citation, tree.id),
    }

    blob = crypto_export.encrypt_bundle(bundle, password or None)
    filename = f"{tree.name or 'family-tree'}.treedb"
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _link_rows(db: Session, link_model, parent_model, tree_id: str) -> list[dict]:
    from sqlalchemy import inspect as sa_inspect

    parent_id_col = next(
        c for c in link_model.__table__.columns if c.name != "member_id"
    ).name
    items = db.scalars(
        select(link_model)
        .join(parent_model, parent_model.id == getattr(link_model, parent_id_col))
        .where(parent_model.tree_id == tree_id)
    ).all()
    cols = [c.key for c in sa_inspect(link_model).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


@router.post("/import/inspect")
async def inspect_import(file: UploadFile, db: Session = Depends(get_db)):
    blob = await file.read()
    try:
        if crypto_export.is_password_protected(blob):
            return {
                "password_required": True,
                "name": None,
                "app_version": None,
                "exported_at": None,
                "bundle_version": None,
            }
        bundle = crypto_export.decrypt_bundle(blob, None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    bundle = _validate_and_migrate(bundle)
    return {
        "password_required": False,
        "name": bundle.get("tree", {}).get("name"),
        "app_version": bundle.get("app_version"),
        "exported_at": bundle.get("exported_at"),
        "bundle_version": bundle.get("version"),
    }


@router.post("/import", response_model=JobStarted, status_code=202)
async def import_tree(
    file: UploadFile,
    password: str | None = Form(default=None),
    name: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    blob = await file.read()
    # Validate synchronously so bad/future files get an immediate error response.
    try:
        bundle = crypto_export.decrypt_bundle(blob, password or None)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail="Password required") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not read export file") from exc
    bundle = _validate_and_migrate(bundle)

    job = create_job(db, user.id, "import")
    background_tasks.add_task(
        run_job, job.id, user.id, _do_import, bundle, name, user.id
    )
    return JobStarted(job_id=job.id)


def _do_import(
    progress_cb: ProgressCallback,
    bundle: dict,
    name: str | None,
    user_id: str,
) -> str:
    """Run the full bundle import in a background thread; return new tree_id."""
    progress_cb(5)
    # bundle is already decrypted and validated by the route handler.
    progress_cb(10)

    db = SessionLocal()
    tree_id: str | None = None
    try:
        tree = Tree(
            id=str(uuid4()),
            name=name or bundle.get("tree", {}).get("name") or "Imported tree",
            owner_id=user_id,
            created_at=utcnow_iso(),
            last_opened=utcnow_iso(),
        )
        db.add(tree)
        db.flush()
        tree_id = tree.id
        progress_cb(15)

        media_limits = get_media_limits(db)
        members = bundle.get("members", [])
        member_map = _remap(members)
        total_members = max(len(members), 1)
        for i, row in enumerate(members):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = member_map[row["id"]]
            data["image_data"] = process_image_field(
                tree.id, data.get("image_data"), media_limits
            )
            db.add(Member(tree_id=tree.id, **data))
            if i % 20 == 0:
                progress_cb(15 + int(40 * i / total_members))
        db.flush()
        progress_cb(55)

        known_types = set(db.scalars(select(RelationType.id)).all())
        for row in bundle.get("relation_types", []):
            if row["id"] not in known_types:
                known_types.add(row["id"])
                db.add(RelationType(id=row["id"], description=row.get("description")))

        for row in bundle.get("relations", []):
            if row["from_member_id"] in member_map and row["to_member_id"] in member_map:
                db.add(
                    Relation(
                        tree_id=tree.id,
                        from_member_id=member_map[row["from_member_id"]],
                        to_member_id=member_map[row["to_member_id"]],
                        relation_type=row["relation_type"],
                    )
                )

        for row in bundle.get("diseases", []):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = str(uuid4())
            data["member_id"] = member_map.get(row["member_id"], row["member_id"])
            if data["member_id"] in member_map.values():
                db.add(MemberDisease(tree_id=tree.id, **data))
        progress_cb(65)

        gallery_map = _remap(bundle.get("gallery_images", []))
        for row in bundle.get("gallery_images", []):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = gallery_map[row["id"]]
            data["image_data"] = process_image_field(
                tree.id, data.get("image_data"), media_limits
            )
            db.add(GalleryImage(tree_id=tree.id, **data))
        _import_links(db, bundle.get("gallery_links", []), GalleryMemberLink,
                      "gallery_image_id", gallery_map, member_map)
        progress_cb(72)

        event_map = _remap(bundle.get("events", []))
        for row in bundle.get("events", []):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = event_map[row["id"]]
            db.add(Event(tree_id=tree.id, **data))
        _import_links(db, bundle.get("event_links", []), EventMemberLink,
                      "event_id", event_map, member_map)
        progress_cb(79)

        story_map = _remap(bundle.get("stories", []))
        for row in bundle.get("stories", []):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = story_map[row["id"]]
            db.add(Story(tree_id=tree.id, **data))
        _import_links(db, bundle.get("story_links", []), StoryMemberLink,
                      "story_id", story_map, member_map)

        db.flush()
        for row in bundle.get("story_attachments", []):
            story_id = story_map.get(row.get("story_id"))
            if story_id is None:
                continue
            try:
                url, mime, size = store_document(
                    tree.id, row["filename"], row["url"], media_limits
                )
            except ValueError:
                continue
            db.add(
                StoryAttachment(
                    id=str(uuid4()),
                    tree_id=tree.id,
                    story_id=story_id,
                    filename=row["filename"],
                    url=url,
                    mime_type=mime,
                    size=size,
                    created_at=row.get("created_at") or utcnow_iso(),
                )
            )
        progress_cb(86)

        source_map = _remap(bundle.get("sources", []))
        for row in bundle.get("sources", []):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = source_map[row["id"]]
            db.add(Source(tree_id=tree.id, **data))
        db.flush()

        for row in bundle.get("source_evidence", []):
            source_id = source_map.get(row.get("source_id"))
            if source_id is None:
                continue
            ev_url = row.get("url", "")
            ev_mime = row.get("mime_type")
            ev_size = row.get("size")
            if row.get("kind") == "file":
                try:
                    ev_url, ev_mime, ev_size = store_document(
                        tree.id, row.get("filename", "file"), ev_url, media_limits,
                    )
                except ValueError:
                    continue
            db.add(
                SourceEvidence(
                    id=str(uuid4()),
                    tree_id=tree.id,
                    source_id=source_id,
                    kind=row.get("kind", "link"),
                    filename=row.get("filename"),
                    url=ev_url,
                    mime_type=ev_mime,
                    size=ev_size,
                    created_at=row.get("created_at") or utcnow_iso(),
                )
            )

        for row in bundle.get("citations", []):
            source_id = source_map.get(row.get("source_id"))
            member_id = member_map.get(row.get("member_id"))
            if source_id is None or member_id is None:
                continue
            db.add(
                Citation(
                    id=str(uuid4()),
                    tree_id=tree.id,
                    source_id=source_id,
                    member_id=member_id,
                    fact_type=row.get("fact_type", "general"),
                    page=row.get("page"),
                    detail=row.get("detail"),
                    created_at=row.get("created_at") or utcnow_iso(),
                )
            )
        progress_cb(90)

        _enforce_import_quota(db, tree)
        db.commit()
        return tree.id
    except Exception:
        db.rollback()
        if tree_id:
            delete_tree_media(tree_id)
        raise
    finally:
        db.close()


def _enforce_import_quota(db: Session, tree: Tree) -> None:
    """Reject an over-quota import, rolling back the whole tree + its media.

    The bundle is fully written (rows flushed, media on disk) before this runs,
    so a single full-usage check enforces the owner's quota; on violation we
    undo every inserted row and remove the tree's media directory.
    """
    tree_id = tree.id
    db.flush()
    try:
        check_full_usage_quota(db, tree)
    except QuotaExceeded as exc:
        db.rollback()
        delete_tree_media(tree_id)
        raise HTTPException(status_code=413, detail=str(exc)) from exc


def _remap(rows: list[dict]) -> dict[str, str]:
    return {row["id"]: str(uuid4()) for row in rows}


def _import_links(db, links, model, parent_key, parent_map, member_map):
    # Make sure the parent rows added just before this call are inserted, so the
    # link rows that reference them don't violate the foreign key.
    db.flush()
    for row in links:
        parent_old = row[parent_key]
        member_old = row["member_id"]
        if parent_old in parent_map and member_old in member_map:
            db.add(
                model(
                    **{
                        parent_key: parent_map[parent_old],
                        "member_id": member_map[member_old],
                    }
                )
            )


# ---------------------------------------------------------------------------
# GEDCOM export / import
# ---------------------------------------------------------------------------


@router.get(
    "/{tree_id}/export-gedcom",
    dependencies=[Depends(require_feature("gedcom"))],
)
def export_tree_gedcom(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
) -> Response:
    """Export the tree as a plain-text GEDCOM 5.5.1 file."""
    members = _rows(db, Member, tree.id)
    relations = _rows(db, Relation, tree.id)
    sources_ged = _rows(db, Source, tree.id)
    citations_ged = _rows(db, Citation, tree.id)
    text = gedcom.serialize_to_gedcom(
        tree.name or "family-tree",
        members,
        relations,
        sources=sources_ged,
        citations=citations_ged,
        app_version=settings.APP_VERSION,
    )
    filename = f"{tree.name or 'family-tree'}.ged"
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/import-gedcom",
    response_model=JobStarted,
    status_code=202,
    dependencies=[Depends(require_feature("gedcom"))],
)
async def import_tree_gedcom(
    file: UploadFile,
    name: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> JobStarted:
    """Import a GEDCOM 5.5.1 file into a new tree owned by the current user."""
    raw = await file.read()
    text = gedcom.decode_gedcom_bytes(raw)

    try:
        parsed = gedcom.parse_gedcom(text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not read GEDCOM file") from exc

    filename_stem = Path(file.filename).stem.strip() if file.filename else ""
    tree_name = (
        name
        or filename_stem
        or parsed.get("_head_file")  # type: ignore[arg-type]
        or "Imported tree"
    )

    job = create_job(db, user.id, "import_gedcom")
    background_tasks.add_task(
        run_job, job.id, user.id, _do_import_gedcom, parsed, tree_name, user.id
    )
    return JobStarted(job_id=job.id)


def _do_import_gedcom(
    progress_cb: ProgressCallback,
    parsed: dict,
    tree_name: str,
    user_id: str,
) -> str:
    """Run the GEDCOM import in a background thread; return new tree_id."""
    progress_cb(5)
    db = SessionLocal()
    tree_id: str | None = None
    try:
        tree = Tree(
            id=str(uuid4()),
            name=tree_name,
            owner_id=user_id,
            created_at=utcnow_iso(),
            last_opened=utcnow_iso(),
        )
        db.add(tree)
        db.flush()
        tree_id = tree.id
        progress_cb(15)

        members = parsed.get("members", [])
        total_members = max(len(members), 1)
        inserted_member_ids: set[str] = set()
        for i, m in enumerate(members):
            data = dict(m)
            data.pop("tree_id", None)
            db.add(Member(tree_id=tree.id, **data))
            inserted_member_ids.add(m["id"])
            if i % 20 == 0:
                progress_cb(15 + int(55 * i / total_members))
        db.flush()
        progress_cb(70)

        for rel in parsed.get("relations", []):
            if (
                rel["from_member_id"] in inserted_member_ids
                and rel["to_member_id"] in inserted_member_ids
            ):
                db.add(
                    Relation(
                        tree_id=tree.id,
                        from_member_id=rel["from_member_id"],
                        to_member_id=rel["to_member_id"],
                        relation_type=rel["relation_type"],
                    )
                )
        progress_cb(90)

        _enforce_import_quota(db, tree)
        db.commit()
        return tree.id
    except Exception:
        db.rollback()
        if tree_id:
            delete_tree_media(tree_id)
        raise
    finally:
        db.close()
