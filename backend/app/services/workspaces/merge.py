"""Server-side tree merge.

Combines one or two source workspaces into a brand-new tree owned by the requesting
user. Members are de-duplicated by (first name, last name, gender, birth, death)
— matching the old client-side merge — and notes from duplicates are combined.
All ids are regenerated (ids are globally unique here), relations/links are
remapped, and member photos / gallery media are copied into the new tree.

New in #166: ``compute_merge_preview`` for a preview endpoint, and optional
per-pair ``resolutions`` that let callers override merge vs keep_both and
choose field values on a conflict.

The member de-duplication pass (``_merge_members``) is merge-specific and
stays here; copying everything else (sections, relations, diseases, tasks,
gallery, events, stories, documents) that merely follows the member id-map
is delegated, one focused function per content domain, to
``app.services.workspaces.merge_copy``.

#1017: sections and content origin scopes are copied into the new tree, so
duplicating/merging preserves section organization. Scoped grants and other
collaborators' saved views are deliberately *not* copied — like workspace
membership, they grant other people access, and a merge/duplicate result is
owned solely by the requesting user until they choose to share it.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.core.exceptions import NotFoundError
from app.db.base import utcnow_iso
from app.models import Member, User, Workspace
from app.schemas.family import MemberOut
from app.schemas.merge import DuplicatePair, MergeResolution, WorkspaceMergePreview
from app.services.activity.activity import record_activity
from app.services.event_bus import publish_workspace_event
from app.services.members.member_clone import (
    apply_field_choices,
    clone_member,
    compute_conflicts,
    member_key,
    member_name_key,
)
from app.services.system.job_service import ProgressCallback
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.merge_copy import (
    MergeContext,
    copy_diseases,
    copy_documents,
    copy_events,
    copy_gallery,
    copy_relations,
    copy_sections,
    copy_stories,
    copy_tasks,
)
from app.services.workspaces.workspace_state import mark_workspace_opened

MemberIdMap = dict[str, str]


def _require_readable(db: Session, user: User, workspace_id: str) -> Workspace:
    tree = db.get(Workspace, workspace_id)
    if tree is None or role_for(db, tree, user) is None:
        raise NotFoundError("Source tree not found")
    return tree


# ---------------------------------------------------------------------------
# Preview computation
# ---------------------------------------------------------------------------


def compute_merge_preview(
    db: Session,
    user: User,
    source_a_id: str,
    source_b_id: str | None,
) -> WorkspaceMergePreview:
    """Compute a merge preview without touching the database."""
    tree_a = _require_readable(db, user, source_a_id)
    tree_b = _require_readable(db, user, source_b_id) if source_b_id else None

    members_a: list[Member] = list(
        db.scalars(select(Member).where(Member.workspace_id == tree_a.id))
    )
    members_b: list[Member] = (
        list(db.scalars(select(Member).where(Member.workspace_id == tree_b.id)))
        if tree_b
        else []
    )

    total_members = len(members_a) + len(members_b)

    if not members_b:
        # Single-source copy: no duplicates possible
        return WorkspaceMergePreview(
            total_members=total_members,
            merged_count=total_members,
            duplicates=[],
        )

    # Index source-A members by exact key and by name key
    exact_by_key: dict[tuple, Member] = {}
    name_by_key: dict[tuple, Member] = {}
    for m in members_a:
        exact_by_key[member_key(m)] = m
        name_by_key[member_name_key(m)] = m

    duplicates: list[DuplicatePair] = []
    exact_matched_b_ids: set[str] = set()
    possible_matched_b_ids: set[str] = set()

    # First pass: exact duplicates
    for mb in members_b:
        exact_key = member_key(mb)
        if exact_key in exact_by_key:
            ma = exact_by_key[exact_key]
            conflicts = compute_conflicts(ma, mb)
            duplicates.append(
                DuplicatePair(
                    member_a=MemberOut.model_validate(ma),
                    member_b=MemberOut.model_validate(mb),
                    match="exact",
                    conflicts=conflicts,
                    default_action="merge",
                )
            )
            exact_matched_b_ids.add(mb.id)

    # Second pass: possible candidates (name+gender match, but dates differ)
    for mb in members_b:
        if mb.id in exact_matched_b_ids:
            continue
        name_key = member_name_key(mb)
        if name_key in name_by_key:
            ma = name_by_key[name_key]
            # Sanity check: must not be an exact match (already handled above)
            if member_key(ma) == member_key(mb):
                continue
            conflicts = compute_conflicts(ma, mb)
            duplicates.append(
                DuplicatePair(
                    member_a=MemberOut.model_validate(ma),
                    member_b=MemberOut.model_validate(mb),
                    match="possible",
                    conflicts=conflicts,
                    default_action="keep_both",
                )
            )
            possible_matched_b_ids.add(mb.id)

    # merged_count = how many rows the result tree would have (under defaults)
    # Exact dupes → 1 row; possible → 2 rows (default keep_both)
    merged_count = total_members - len(exact_matched_b_ids)

    return WorkspaceMergePreview(
        total_members=total_members,
        merged_count=merged_count,
        duplicates=duplicates,
    )


# ---------------------------------------------------------------------------
# Resolution index helpers
# ---------------------------------------------------------------------------


def _build_resolution_index(
    resolutions: list[MergeResolution] | None,
) -> dict[frozenset, MergeResolution]:
    """Map {frozenset({id_a, id_b})} → resolution for O(1) lookup."""
    if not resolutions:
        return {}
    return {frozenset({r.member_a_id, r.member_b_id}): r for r in resolutions}


# ---------------------------------------------------------------------------
# Member de-duplication pass
# ---------------------------------------------------------------------------


def _merge_members(
    db: Session,
    new_tree_id: str,
    members_a: list[Member],
    members_b: list[Member],
    res_index: dict[frozenset, MergeResolution],
) -> MemberIdMap:
    """Clone source-A and source-B members into the new tree, de-duplicating.

    Returns the source member id → new-tree member id map every other content
    copier in ``app.services.workspaces.merge_copy`` keys off of.
    """
    # member_map: source member id → new tree member id
    member_map: MemberIdMap = {}
    # dedup: exact-match key → clone Member object (so we can apply field merges)
    dedup: dict[tuple, Member] = {}
    # name-key index for possible-candidate detection
    name_index: dict[tuple, tuple[Member, str]] = {}  # name_key → (clone, original_a_id)

    # ---- Pass 1: clone all source-A members ----
    for ma in members_a:
        new_id = str(uuid4())
        member_map[ma.id] = new_id
        clone = clone_member(ma, new_tree_id, new_id)
        db.add(clone)
        dedup[member_key(ma)] = clone
        name_index[member_name_key(ma)] = (clone, ma.id)

    # ---- Pass 2: process source-B members ----
    for mb in members_b:
        exact_key = member_key(mb)
        name_key = member_name_key(mb)

        # --- Check resolution for this pair (if any) ---
        # We need to find the matching source-A member to look up the resolution.
        matched_a_clone: Member | None = dedup.get(exact_key)
        matched_a_id: str | None = None
        match_type: str | None = None

        if matched_a_clone is not None:
            # Exact match found
            # Find the original A member id from the member_map (reverse lookup)
            for orig_id, new_id in member_map.items():
                if new_id == matched_a_clone.id:
                    matched_a_id = orig_id
                    break
            match_type = "exact"
        elif name_key in name_index:
            # Possible candidate (name+gender match, dates differ)
            matched_a_clone, matched_a_id = name_index[name_key]
            match_type = "possible"

        if matched_a_id is not None and matched_a_clone is not None:
            res_key = frozenset({matched_a_id, mb.id})
            resolution = res_index.get(res_key)

            if match_type == "exact":
                # Default behaviour: merge (unless keep_both resolution)
                action = resolution.action if resolution else "merge"
            else:
                # Possible candidate: default keep_both (unless merge resolution)
                action = resolution.action if resolution else "keep_both"

            if action == "keep_both":
                # Clone B as a separate member
                new_id = str(uuid4())
                member_map[mb.id] = new_id
                clone_b = clone_member(mb, new_tree_id, new_id)
                db.add(clone_b)
            else:
                # Merge: B maps to A's clone; apply field choices if given
                member_map[mb.id] = matched_a_clone.id
                if resolution and resolution.fields:
                    # Find the original A member for field comparison
                    orig_ma = next((m for m in members_a if m.id == matched_a_id), None)
                    if orig_ma is not None:
                        apply_field_choices(
                            matched_a_clone, orig_ma, mb, resolution.fields
                        )
                else:
                    # Legacy behaviour: combine additional_data
                    if (
                        mb.additional_data
                        and mb.additional_data != matched_a_clone.additional_data
                    ):
                        matched_a_clone.additional_data = (
                            f"{matched_a_clone.additional_data}\n\n{mb.additional_data}"
                            if matched_a_clone.additional_data
                            else mb.additional_data
                        )
        else:
            # No match: always clone as new
            new_id = str(uuid4())
            member_map[mb.id] = new_id
            clone = clone_member(mb, new_tree_id, new_id)
            db.add(clone)

    return member_map


# ---------------------------------------------------------------------------
# Main merge entry point
# ---------------------------------------------------------------------------


def merge_trees(
    db: Session,
    user: User,
    name: str,
    source_a_id: str,
    source_b_id: str | None,
    resolutions: list[MergeResolution] | None = None,
    progress_cb: ProgressCallback | None = None,
) -> Workspace:
    def _progress(pct: int) -> None:
        if progress_cb is not None:
            progress_cb(pct)

    tree_a = _require_readable(db, user, source_a_id)
    tree_b = _require_readable(db, user, source_b_id) if source_b_id else None
    sources = [t for t in (tree_a, tree_b) if t is not None]

    res_index = _build_resolution_index(resolutions)

    new_tree = Workspace(
        id=str(uuid4()),
        name=name,
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()
    mark_workspace_opened(db, new_tree.id, user.id)
    _progress(10)

    members_a = list(db.scalars(select(Member).where(Member.workspace_id == tree_a.id)))
    members_b = (
        list(db.scalars(select(Member).where(Member.workspace_id == tree_b.id)))
        if tree_b
        else []
    )
    member_map = _merge_members(db, new_tree.id, members_a, members_b, res_index)

    # Members must exist before relations/diseases/links reference them.
    db.flush()
    _progress(50)

    ctx = MergeContext(new_tree_id=new_tree.id, sources=sources, member_map=member_map)

    copy_sections(db, ctx)
    copy_relations(db, ctx)
    copy_diseases(db, ctx)
    copy_tasks(db, ctx)
    _progress(60)

    copy_gallery(db, ctx)
    _progress(70)

    copy_events(db, ctx)
    _progress(80)

    copy_stories(db, ctx)
    copy_documents(db, ctx)

    _progress(95)
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=new_tree.id,
            actor=user,
            action="create",
            target_type="merge",
            target_id=new_tree.id,
            target_label=new_tree.name,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, new_tree, "activity.entry_added", {"workspace_id": new_tree.id}
            )
        )
    db.refresh(new_tree)
    return new_tree
