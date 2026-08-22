"""GEDCOM 5.5.1 tree import.

Runs the GEDCOM import in a background job (``do_import_gedcom``). Simpler
than the native bundle import (``app.services.tree_bundle_import``) — GEDCOM
carries only members and relations — but shares the same quota-enforcement
and rollback contract.
"""

from __future__ import annotations

from uuid import uuid4

from app.db.base import utcnow_iso
from app.db.session import SessionLocal
from app.models import Member, Relation, Tree, User
from app.services.activity import record_activity
from app.services.bundle_types import GedcomParseResult
from app.services.event_bus import publish_tree_event
from app.services.job_service import ProgressCallback
from app.services.storage import delete_tree_media
from app.services.tree_bundle_import import (
    BULK_CHUNK,
    bulk_insert_chunked,
    enforce_import_quota,
)
from app.services.tree_state import mark_tree_opened


def do_import_gedcom(
    progress_cb: ProgressCallback,
    parsed: GedcomParseResult,
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
        )
        db.add(tree)
        db.flush()
        mark_tree_opened(db, tree.id, user_id)
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
            if i % BULK_CHUNK == 0:
                progress_cb(15 + int(55 * i / total_members))

        bulk_insert_chunked(db, Member, member_dicts)
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
        bulk_insert_chunked(db, Relation, relation_dicts)
        progress_cb(90)

        enforce_import_quota(db, tree)
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
