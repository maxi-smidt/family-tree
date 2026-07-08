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
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree, require_feature
from app.core.config import settings
from app.db.base import utcnow_iso
from app.db.session import SessionLocal, get_db
from app.models import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    RelationType,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
    User,
)
from app.schemas.job import JobStarted
from app.services import crypto_export, gedcom
from app.services.activity import record_activity
from app.services.event_bus import publish_tree_event
from app.services.genealogy_date import sort_key as _sort_key
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

# Number of rows to write per bulk-insert batch.
_BULK_CHUNK = 1000


def _bulk_insert_chunked(db: Session, model: type, mappings: list[dict]) -> None:
    """Bulk-insert ``mappings`` for ``model`` in ``_BULK_CHUNK``-sized batches.

    ``bulk_insert_mappings`` bypasses the ORM ``__init__``/validators, so
    callers must precompute any values those would normally derive (e.g. the
    ``*_sort`` columns on Member).
    """
    for start in range(0, len(mappings), _BULK_CHUNK):
        chunk = mappings[start:start + _BULK_CHUNK]
        if chunk:
            db.bulk_insert_mappings(model, chunk)


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

    document_files = _rows(db, DocumentFile, tree.id)
    for f in document_files:
        if f.get("kind") == "file":
            f["url"] = media_url_to_data_url(f.get("url"))

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
        "documents": _rows(db, Document, tree.id),
        "document_files": document_files,
        "document_member_links": _document_link_rows(db, DocumentMemberLink, tree.id),
        "event_document_links": _document_link_rows(db, EventDocumentLink, tree.id),
        "story_document_links": _document_link_rows(db, StoryDocumentLink, tree.id),
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


def _document_link_rows(db: Session, link_model, tree_id: str) -> list[dict]:
    """Rows of a document_id-keyed link table (member/event/story) scoped to
    *tree_id* via the Document side — every such link table has a
    ``document_id`` column and Document always carries ``tree_id``."""
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(
        select(link_model)
        .join(Document, Document.id == link_model.document_id)
        .where(Document.tree_id == tree_id)
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
        bundle = await run_in_threadpool(crypto_export.decrypt_bundle, blob, None)
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
        bundle = await run_in_threadpool(
            crypto_export.decrypt_bundle, blob, password or None
        )
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

        # Build per-row member dicts (image processing must stay per-row), then
        # bulk-insert in chunks for performance on large imports.
        member_dicts: list[dict] = []
        for i, row in enumerate(members):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = member_map[row["id"]]
            data["tree_id"] = tree.id
            data["image_data"] = process_image_field(
                tree.id, data.get("image_data"), media_limits
            )
            # Older bundles may not include the sort columns; compute if missing.
            if data.get("date_of_birth_sort") is None:
                data["date_of_birth_sort"] = _sort_key(data.get("date_of_birth"))
            if data.get("date_of_death_sort") is None:
                data["date_of_death_sort"] = _sort_key(data.get("date_of_death"))
            member_dicts.append(data)

            if i % _BULK_CHUNK == 0:
                progress_cb(15 + int(40 * i / total_members))

        _bulk_insert_chunked(db, Member, member_dicts)
        db.flush()
        progress_cb(55)

        known_types = set(db.scalars(select(RelationType.id)).all())
        for row in bundle.get("relation_types", []):
            if row["id"] not in known_types:
                known_types.add(row["id"])
                db.add(RelationType(id=row["id"], description=row.get("description")))

        relation_dicts: list[dict] = [
            {
                "tree_id": tree.id,
                "from_member_id": member_map[row["from_member_id"]],
                "to_member_id": member_map[row["to_member_id"]],
                "relation_type": row["relation_type"],
            }
            for row in bundle.get("relations", [])
            if row["from_member_id"] in member_map and row["to_member_id"] in member_map
        ]
        _bulk_insert_chunked(db, Relation, relation_dicts)

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
        progress_cb(84)

        document_map = _remap(bundle.get("documents", []))
        for row in bundle.get("documents", []):
            data = dict(row)
            data.pop("tree_id", None)
            data["id"] = document_map[row["id"]]
            db.add(Document(tree_id=tree.id, **data))
        db.flush()  # documents before their files/links

        for row in bundle.get("document_files", []):
            document_id = document_map.get(row.get("document_id"))
            if document_id is None:
                continue
            file_url = row.get("url", "")
            file_mime = row.get("mime_type")
            file_size = row.get("size")
            if row.get("kind") == "file":
                try:
                    file_url, file_mime, file_size = store_document(
                        tree.id, row.get("filename") or "file", file_url, media_limits,
                    )
                except ValueError:
                    continue
            db.add(
                DocumentFile(
                    id=str(uuid4()),
                    tree_id=tree.id,
                    document_id=document_id,
                    kind=row.get("kind", "link"),
                    filename=row.get("filename"),
                    url=file_url,
                    mime_type=file_mime,
                    size=file_size,
                    created_at=row.get("created_at") or utcnow_iso(),
                )
            )
        progress_cb(87)

        _import_links(db, bundle.get("document_member_links", []),
                      DocumentMemberLink, "document_id", document_map, member_map)
        _import_doc_links(db, bundle.get("event_document_links", []),
                          EventDocumentLink, "event_id", event_map, document_map)
        _import_doc_links(db, bundle.get("story_document_links", []),
                          StoryDocumentLink, "story_id", story_map, document_map)
        progress_cb(90)

        _enforce_import_quota(db, tree)
        user = db.get(User, user_id)
        if user is not None:
            record_activity(
                db, tree_id=tree.id, actor=user, action="create",
                target_type="import", target_id=tree.id, target_label=tree.name,
            )
        db.commit()
        if user is not None:
            publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
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


def _import_doc_links(db, links, model, parent_key, parent_map, document_map):
    """Like ``_import_links`` but for the document_id-keyed link tables
    (event_document_link / story_document_link)."""
    db.flush()
    for row in links:
        parent_old = row[parent_key]
        document_old = row["document_id"]
        if parent_old in parent_map and document_old in document_map:
            db.add(
                model(
                    **{
                        parent_key: parent_map[parent_old],
                        "document_id": document_map[document_old],
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
    documents_ged = _rows(db, Document, tree.id)
    document_files_ged = [
        f for f in _rows(db, DocumentFile, tree.id) if f.get("kind") == "file"
    ]
    citations_ged = _document_link_rows(db, DocumentMemberLink, tree.id)
    text = gedcom.serialize_to_gedcom(
        tree.name or "family-tree",
        members,
        relations,
        documents=documents_ged,
        document_files=document_files_ged,
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
    text = await run_in_threadpool(gedcom.decode_gedcom_bytes, raw)

    try:
        parsed = await run_in_threadpool(gedcom.parse_gedcom, text)
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

        # Build mapping dicts for bulk insert; collect ids for relation filter.
        member_dicts: list[dict] = []
        for i, m in enumerate(members):
            data = dict(m)
            data.pop("tree_id", None)
            data["tree_id"] = tree.id
            member_dicts.append(data)
            inserted_member_ids.add(m["id"])
            if i % _BULK_CHUNK == 0:
                progress_cb(15 + int(55 * i / total_members))

        _bulk_insert_chunked(db, Member, member_dicts)
        db.flush()
        progress_cb(70)

        relation_dicts: list[dict] = [
            {
                "tree_id": tree.id,
                "from_member_id": rel["from_member_id"],
                "to_member_id": rel["to_member_id"],
                "relation_type": rel["relation_type"],
            }
            for rel in parsed.get("relations", [])
            if (
                rel["from_member_id"] in inserted_member_ids
                and rel["to_member_id"] in inserted_member_ids
            )
        ]
        _bulk_insert_chunked(db, Relation, relation_dicts)
        progress_cb(90)

        _enforce_import_quota(db, tree)
        user = db.get(User, user_id)
        if user is not None:
            record_activity(
                db, tree_id=tree.id, actor=user, action="create",
                target_type="import", target_id=tree.id, target_label=tree.name,
            )
        db.commit()
        if user is not None:
            publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        return tree.id
    except Exception:
        db.rollback()
        if tree_id:
            delete_tree_media(tree_id)
        raise
    finally:
        db.close()
