"""Encrypted export and import of an entire tree, plus GEDCOM import/export.

Encrypted exports are always encrypted at rest; a user password is optional.
GEDCOM exports produce a plain-text GEDCOM 5.5.1 file.
Imports (both formats) always land in a brand new tree owned by the importing
user, with every id remapped so re-importing never collides with existing data.
"""

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree, require_feature
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import (
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    RelationType,
    Story,
    StoryAttachment,
    StoryMemberLink,
    Tree,
    User,
)
from app.schemas.tree import TreeOut
from app.services import crypto_export, gedcom
from app.services.storage import (
    media_url_to_data_url,
    process_image_field,
    store_document,
)

router = APIRouter(prefix="/trees", tags=["export"])

BUNDLE_VERSION = 1


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
        m["imageData"] = media_url_to_data_url(m.get("imageData"))
    gallery = _rows(db, GalleryImage, tree.id)
    for g in gallery:
        g["imageData"] = media_url_to_data_url(g.get("imageData"))
    story_attachments = _rows(db, StoryAttachment, tree.id)
    for a in story_attachments:
        a["url"] = media_url_to_data_url(a.get("url"))

    bundle = {
        "version": BUNDLE_VERSION,
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
            return {"password_required": True, "name": None}
        bundle = crypto_export.decrypt_bundle(blob, None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"password_required": False, "name": bundle.get("tree", {}).get("name")}


@router.post("/import", response_model=TreeOut, status_code=201)
async def import_tree(
    file: UploadFile,
    password: str | None = Form(default=None),
    name: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    blob = await file.read()
    try:
        bundle = crypto_export.decrypt_bundle(blob, password or None)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail="Password required") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not read export file") from exc

    tree = Tree(
        id=str(uuid4()),
        name=name or bundle.get("tree", {}).get("name") or "Imported tree",
        owner_id=user.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(tree)
    db.flush()

    member_map = _remap(bundle.get("members", []))
    for row in bundle.get("members", []):
        data = dict(row)
        data.pop("tree_id", None)
        data["id"] = member_map[row["id"]]
        data["imageData"] = process_image_field(tree.id, data.get("imageData"))
        db.add(Member(tree_id=tree.id, **data))
    # Members must exist before anything that references them (relations,
    # diseases, gallery/event/story links).
    db.flush()

    # Register any relation types this instance does not know yet, so every
    # imported relation stays selectable in the UI.
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

    gallery_map = _remap(bundle.get("gallery_images", []))
    for row in bundle.get("gallery_images", []):
        data = dict(row)
        data.pop("tree_id", None)
        data["id"] = gallery_map[row["id"]]
        data["imageData"] = process_image_field(tree.id, data.get("imageData"))
        db.add(GalleryImage(tree_id=tree.id, **data))
    _import_links(db, bundle.get("gallery_links", []), GalleryMemberLink,
                  "gallery_image_id", gallery_map, member_map)

    event_map = _remap(bundle.get("events", []))
    for row in bundle.get("events", []):
        data = dict(row)
        data.pop("tree_id", None)
        data["id"] = event_map[row["id"]]
        db.add(Event(tree_id=tree.id, **data))
    _import_links(db, bundle.get("event_links", []), EventMemberLink,
                  "event_id", event_map, member_map)

    story_map = _remap(bundle.get("stories", []))
    for row in bundle.get("stories", []):
        data = dict(row)
        data.pop("tree_id", None)
        data["id"] = story_map[row["id"]]
        db.add(Story(tree_id=tree.id, **data))
    _import_links(db, bundle.get("story_links", []), StoryMemberLink,
                  "story_id", story_map, member_map)

    # Story attachments: re-persist each inlined file under the new tree.
    db.flush()  # stories must exist before their attachments
    for row in bundle.get("story_attachments", []):
        story_id = story_map.get(row.get("story_id"))
        if story_id is None:
            continue
        try:
            url, mime, size = store_document(tree.id, row["filename"], row["url"])
        except ValueError:
            continue  # skip an attachment we can't decode rather than fail the import
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

    db.commit()
    db.refresh(tree)
    out = TreeOut.model_validate(tree)
    out.role = "owner"
    return out


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
    text = gedcom.serialize_to_gedcom(tree.name or "family-tree", members, relations)
    filename = f"{tree.name or 'family-tree'}.ged"
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/import-gedcom",
    response_model=TreeOut,
    status_code=201,
    dependencies=[Depends(require_feature("gedcom"))],
)
async def import_tree_gedcom(
    file: UploadFile,
    name: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TreeOut:
    """Import a GEDCOM 5.5.1 file into a new tree owned by the current user."""
    raw = await file.read()
    text = gedcom.decode_gedcom_bytes(raw)

    try:
        parsed = gedcom.parse_gedcom(text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not read GEDCOM file") from exc

    # Resolve tree name: explicit form field > filename stem > HEAD FILE > default.
    filename_stem = Path(file.filename).stem.strip() if file.filename else ""
    tree_name = (
        name
        or filename_stem
        or parsed.get("_head_file")  # type: ignore[arg-type]
        or "Imported tree"
    )

    tree = Tree(
        id=str(uuid4()),
        name=tree_name,
        owner_id=user.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(tree)
    db.flush()

    # Insert members first (relations have FK to members).
    inserted_member_ids: set[str] = set()
    for m in parsed.get("members", []):
        data = dict(m)
        data.pop("tree_id", None)
        db.add(Member(tree_id=tree.id, **data))
        inserted_member_ids.add(m["id"])
    db.flush()

    # Insert relations — guard against any endpoints not in the member set.
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

    db.commit()
    db.refresh(tree)
    out = TreeOut.model_validate(tree)
    out.role = "owner"
    return out
