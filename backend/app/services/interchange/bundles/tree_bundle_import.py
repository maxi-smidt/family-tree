"""Native (encrypted-bundle) tree import.

Runs the full bundle import in a background job (``do_import``): every id is
remapped so re-importing the same bundle never collides with existing data,
media is decoded and written to the new tree's storage as rows are inserted,
and the whole tree (rows + media) is rolled back if quota enforcement or
anything else fails partway through.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import QuotaExceeded
from app.db.base import utcnow_iso
from app.db.session import SessionLocal
from app.models import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
    Member,
    MemberDisease,
    MemberTask,
    MemberTaskLink,
    Relation,
    RelationType,
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    Section,
    SectionMember,
    SectionPosition,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    User,
    Workspace,
)
from app.services.activity.activity import record_activity
from app.services.event_bus import publish_workspace_event
from app.services.interchange.bundles.bundle_types import TreeBundleV5
from app.services.interchange.gedcom.genealogy_date import sort_key as _sort_key
from app.services.media.storage import (
    delete_workspace_media,
    process_image_field,
    store_document,
)
from app.services.media.storage_usage import check_full_usage_quota
from app.services.members.member_search import normalize_member_name
from app.services.system.job_service import ProgressCallback
from app.services.system.settings_service import get_media_limits
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.workspace_state import mark_workspace_opened

# Number of rows to write per bulk-insert batch.
BULK_CHUNK = 1000


def bulk_insert_chunked(db: Session, model: type, mappings: list[dict]) -> None:
    """Bulk-insert ``mappings`` for ``model`` in ``BULK_CHUNK``-sized batches.

    ``bulk_insert_mappings`` bypasses the ORM ``__init__``/validators, so
    callers must precompute any values those would normally derive (e.g. the
    ``*_sort`` columns on Member).
    """
    for start in range(0, len(mappings), BULK_CHUNK):
        chunk = mappings[start : start + BULK_CHUNK]
        if chunk:
            db.bulk_insert_mappings(model, chunk)


def enforce_import_quota(db: Session, tree: Workspace) -> None:
    """Reject an over-quota import, rolling back the whole tree + its media.

    The bundle is fully written (rows flushed, media on disk) before this runs,
    so a single full-usage check enforces the owner's quota; on violation we
    undo every inserted row and remove the tree's media directory. Shared by
    the GEDCOM importer (``app.services.interchange.gedcom.tree_gedcom_import``) too.
    """
    workspace_id = tree.id
    db.flush()
    try:
        check_full_usage_quota(db, tree)
    except QuotaExceeded:
        # allowlisted-rollback: undoes the whole import's flushed-but-uncommitted
        # rows on an over-quota rejection, ahead of and separate from the
        # narrow UnitOfWork commit that follows a successful check.
        db.rollback()
        delete_workspace_media(workspace_id)
        raise


def _remap(rows: list[dict]) -> dict[str, str]:
    return {row["id"]: str(uuid4()) for row in rows}


def _import_links(db, links, model, parent_key, parent_map, member_map):
    # Make sure the parent rows added just before this call are inserted, so the
    # link rows that reference them don't violate the foreign key.
    db.flush()
    model_columns = {column.name for column in model.__table__.columns}
    for row in links:
        parent_old = row[parent_key]
        member_old = row["member_id"]
        if parent_old in parent_map and member_old in member_map:
            data = {key: value for key, value in row.items() if key in model_columns}
            data[parent_key] = parent_map[parent_old]
            data["member_id"] = member_map[member_old]
            db.add(model(**data))


def _import_unknown_faces(db, faces, gallery_map, task_map):
    """Import gallery_unknown_faces rows with fresh ids.

    A face whose image did not survive import (shouldn't happen — images are
    never dropped) is skipped; a face whose task did not survive import (e.g.
    an older export missing task rows) keeps its region as an unresolved tag
    with ``task_id`` left null rather than being dropped.
    """
    db.flush()
    for row in faces:
        gallery_image_id = gallery_map.get(row.get("gallery_image_id"))
        if gallery_image_id is None:
            continue
        db.add(
            GalleryUnknownFace(
                id=str(uuid4()),
                gallery_image_id=gallery_image_id,
                x=row.get("x"),
                y=row.get("y"),
                w=row.get("w"),
                h=row.get("h"),
                task_id=task_map.get(row.get("task_id")),
                created_at=row.get("created_at"),
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


def do_import(
    progress_cb: ProgressCallback,
    bundle: TreeBundleV5,
    name: str | None,
    user_id: str,
) -> str:
    """Run the full bundle import in a background thread; return new workspace_id."""
    progress_cb(5)
    # bundle is already decrypted and validated by the route handler.
    progress_cb(10)

    db = SessionLocal()
    workspace_id: str | None = None
    try:
        tree = Workspace(
            id=str(uuid4()),
            name=name or bundle.get("tree", {}).get("name") or "Imported tree",
            owner_id=user_id,
            created_at=utcnow_iso(),
        )
        db.add(tree)
        db.flush()
        mark_workspace_opened(db, tree.id, user_id)
        workspace_id = tree.id
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
            # Never carry a bridge pointer into the newly imported workspace:
            # it names a member id in another (possibly inaccessible) tree,
            # and re-importing under fresh ids makes it stale even when it
            # once pointed at something real. See export_tree's matching strip.
            data.pop("linked_tree_id", None)
            data.pop("linked_workspace_id", None)
            data.pop("linked_member_id", None)
            data.pop("tree_id", None)
            data.pop("workspace_id", None)
            data["id"] = member_map[row["id"]]
            data["workspace_id"] = tree.id
            data["image_data"] = process_image_field(
                tree.id, data.get("image_data"), media_limits
            )
            # Older bundles may not include the sort columns; compute if missing.
            if data.get("date_of_birth_sort") is None:
                data["date_of_birth_sort"] = _sort_key(data.get("date_of_birth"))
            if data.get("date_of_death_sort") is None:
                data["date_of_death_sort"] = _sort_key(data.get("date_of_death"))
            # Bypassing the ORM means Member._derive_name_normalized never
            # runs (#1024) — derive it the same way here.
            data["name_normalized"] = normalize_member_name(
                data.get("first_name"), data.get("last_name"), data.get("maiden_name")
            )
            member_dicts.append(data)

            if i % BULK_CHUNK == 0:
                progress_cb(15 + int(40 * i / total_members))

        bulk_insert_chunked(db, Member, member_dicts)
        db.flush()
        progress_cb(55)

        known_types = set(db.scalars(select(RelationType.id)).all())
        for row in bundle.get("relation_types", []):
            if row["id"] not in known_types:
                known_types.add(row["id"])
                db.add(RelationType(id=row["id"], description=row.get("description")))

        relation_dicts: list[dict] = [
            {
                "workspace_id": tree.id,
                "from_member_id": member_map[row["from_member_id"]],
                "to_member_id": member_map[row["to_member_id"]],
                "relation_type": row["relation_type"],
            }
            for row in bundle.get("relations", [])
            if row["from_member_id"] in member_map and row["to_member_id"] in member_map
        ]
        bulk_insert_chunked(db, Relation, relation_dicts)

        section_map = _remap(bundle.get("sections", []))
        for row in bundle.get("sections", []):
            db.add(
                Section(
                    id=section_map[row["id"]],
                    workspace_id=tree.id,
                    name=row["name"],
                    position=row.get("position", 0),
                    created_at=row.get("created_at") or utcnow_iso(),
                )
            )
        _import_links(
            db,
            bundle.get("section_members", []),
            SectionMember,
            "section_id",
            section_map,
            member_map,
        )
        _import_links(
            db,
            bundle.get("section_positions", []),
            SectionPosition,
            "section_id",
            section_map,
            member_map,
        )

        for row in bundle.get("diseases", []):
            data = dict(row)
            data.pop("tree_id", None)
            data.pop("workspace_id", None)
            data["id"] = str(uuid4())
            data["member_id"] = member_map.get(row["member_id"], row["member_id"])
            if data["member_id"] in member_map.values():
                db.add(MemberDisease(workspace_id=tree.id, **data))

        task_map = _remap(bundle.get("tasks", []))
        for row in bundle.get("tasks", []):
            data = dict(row)
            data.pop("tree_id", None)
            data.pop("workspace_id", None)
            data["id"] = task_map[row["id"]]
            db.add(MemberTask(workspace_id=tree.id, **data))
        _import_links(
            db,
            bundle.get("task_links", []),
            MemberTaskLink,
            "task_id",
            task_map,
            member_map,
        )
        progress_cb(65)

        gallery_map = _remap(bundle.get("gallery_images", []))
        for row in bundle.get("gallery_images", []):
            data = dict(row)
            data.pop("tree_id", None)
            data.pop("workspace_id", None)
            data["id"] = gallery_map[row["id"]]
            data["image_data"] = process_image_field(
                tree.id, data.get("image_data"), media_limits
            )
            db.add(GalleryImage(workspace_id=tree.id, **data))
        _import_links(
            db,
            bundle.get("gallery_links", []),
            GalleryMemberLink,
            "gallery_image_id",
            gallery_map,
            member_map,
        )
        _import_unknown_faces(db, bundle.get("unknown_faces", []), gallery_map, task_map)
        progress_cb(72)

        event_map = _remap(bundle.get("events", []))
        for row in bundle.get("events", []):
            data = dict(row)
            data.pop("tree_id", None)
            data.pop("workspace_id", None)
            data["id"] = event_map[row["id"]]
            db.add(Event(workspace_id=tree.id, **data))
        _import_links(
            db,
            bundle.get("event_links", []),
            EventMemberLink,
            "event_id",
            event_map,
            member_map,
        )
        progress_cb(79)

        story_map = _remap(bundle.get("stories", []))
        for row in bundle.get("stories", []):
            data = dict(row)
            data.pop("tree_id", None)
            data.pop("workspace_id", None)
            data["id"] = story_map[row["id"]]
            db.add(Story(workspace_id=tree.id, **data))
        _import_links(
            db,
            bundle.get("story_links", []),
            StoryMemberLink,
            "story_id",
            story_map,
            member_map,
        )
        db.flush()
        progress_cb(84)

        document_map = _remap(bundle.get("documents", []))
        for row in bundle.get("documents", []):
            data = dict(row)
            data.pop("tree_id", None)
            data.pop("workspace_id", None)
            data["id"] = document_map[row["id"]]
            db.add(Document(workspace_id=tree.id, **data))
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
                        tree.id,
                        row.get("filename") or "file",
                        file_url,
                        media_limits,
                    )
                except ValueError:
                    continue
            db.add(
                DocumentFile(
                    id=str(uuid4()),
                    workspace_id=tree.id,
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

        _import_links(
            db,
            bundle.get("document_member_links", []),
            DocumentMemberLink,
            "document_id",
            document_map,
            member_map,
        )
        _import_doc_links(
            db,
            bundle.get("event_document_links", []),
            EventDocumentLink,
            "event_id",
            event_map,
            document_map,
        )
        _import_doc_links(
            db,
            bundle.get("story_document_links", []),
            StoryDocumentLink,
            "story_id",
            story_map,
            document_map,
        )

        # Saved views always re-parent to the importing user (see export_tree's
        # docstring note) — the original owner may not even exist on this
        # instance.
        saved_view_map = _remap(bundle.get("saved_views", []))
        for row in bundle.get("saved_views", []):
            data = dict(row)
            data.pop("id", None)
            data.pop("workspace_id", None)
            data.pop("owner_id", None)
            focus_member_old = data.pop("focus_member_id", None)
            db.add(
                SavedView(
                    id=saved_view_map[row["id"]],
                    workspace_id=tree.id,
                    owner_id=user_id,
                    focus_member_id=member_map.get(focus_member_old),
                    **data,
                )
            )
        db.flush()
        for row in bundle.get("saved_view_sections", []):
            saved_view_id = saved_view_map.get(row.get("saved_view_id"))
            section_id = section_map.get(row.get("section_id"))
            if saved_view_id is not None and section_id is not None:
                db.add(
                    SavedViewSection(
                        saved_view_id=saved_view_id,
                        section_id=section_id,
                        workspace_id=tree.id,
                    )
                )
        for row in bundle.get("saved_view_positions", []):
            saved_view_id = saved_view_map.get(row.get("saved_view_id"))
            old_node_id = row.get("node_id", "")
            # A synthetic match-group anchor (see SavedViewPosition, "vm_"
            # prefix) names no member at all, so it carries over as-is rather
            # than being remapped like a real member id.
            node_id = (
                old_node_id
                if old_node_id.startswith("vm_")
                else member_map.get(old_node_id)
            )
            if saved_view_id is not None and node_id is not None:
                db.add(
                    SavedViewPosition(
                        saved_view_id=saved_view_id,
                        node_id=node_id,
                        position_x=row["position_x"],
                        position_y=row["position_y"],
                    )
                )
        progress_cb(90)

        enforce_import_quota(db, tree)
        user = db.get(User, user_id)
        with UnitOfWork(db) as uow:
            if user is not None:
                record_activity(
                    db,
                    workspace_id=tree.id,
                    actor=user,
                    action="create",
                    target_type="import",
                    target_id=tree.id,
                    target_label=tree.name,
                )
                uow.after_commit(
                    lambda: publish_workspace_event(
                        db, tree, "activity.entry_added", {"workspace_id": tree.id}
                    )
                )
        return tree.id
    except Exception:
        # allowlisted-rollback: this background job's own session — covers a
        # failure anywhere above, not just the narrow UnitOfWork block's commit.
        db.rollback()
        if workspace_id:
            delete_workspace_media(workspace_id)
        raise
    finally:
        db.close()
