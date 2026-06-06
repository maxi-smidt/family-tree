"""Encrypted export and import of an entire tree.

Exports are always encrypted at rest (the only place data is encrypted now);
a user password is optional. Imports always land in a brand new tree owned by
the importing user, with every id remapped so re-importing never collides with
existing data.
"""

from uuid import uuid4

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree
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
    StoryMemberLink,
    Tree,
    User,
)
from app.schemas.tree import TreeOut
from app.services import crypto_export
from app.services.storage import media_url_to_data_url, process_image_field

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

    bundle = {
        "version": BUNDLE_VERSION,
        "tree": {"name": tree.name, "created_at": tree.created_at},
        "members": members,
        "relations": _rows(db, Relation, tree.id),
        "relation_types": _rows(db, RelationType, tree.id),
        "diseases": _rows(db, MemberDisease, tree.id),
        "gallery_images": gallery,
        "gallery_links": _link_rows(db, GalleryMemberLink, GalleryImage, tree.id),
        "events": _rows(db, Event, tree.id),
        "event_links": _link_rows(db, EventMemberLink, Event, tree.id),
        "stories": _rows(db, Story, tree.id),
        "story_links": _link_rows(db, StoryMemberLink, Story, tree.id),
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
    except PermissionError:
        raise HTTPException(status_code=401, detail="Password required")
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

    for row in bundle.get("relation_types", []):
        db.add(
            RelationType(
                tree_id=tree.id, id=row["id"], description=row.get("description")
            )
        )

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
