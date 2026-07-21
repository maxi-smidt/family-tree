"""In-place, same-tree member merge (#729).

Unlike ``app.services.merge`` (which clones two whole *trees* into a brand
new third tree), this combines two *members of the same tree*: one survives
(``keep``), the other is removed (``remove``) after everything it owns —
relations, content links, diseases, and an optional tree-in-tree bridge — has
been re-pointed onto ``keep``. Field-conflict detection/resolution is reused
from ``app.services.merge`` rather than forked.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Literal

from fastapi import HTTPException
from pydantic.alias_generators import to_camel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    DocumentMemberLink,
    EventMemberLink,
    GalleryMemberLink,
    Member,
    MemberDisease,
    MemberTaskLink,
    Relation,
    StoryMemberLink,
    Tree,
)
from app.schemas.family import MemberOut
from app.schemas.merge import (
    DuplicatePair,
    MemberMergePreviewOut,
    MemberMergeTransferCounts,
)
from app.services.activity import SNAPSHOT_VERSION, member_delete_snapshot
from app.services.merge import (
    CONFLICT_FIELDS,
    _norm,
    _to_snake_case,
    apply_field_choices,
    compute_conflicts,
    member_key,
)
from app.services.quality_checks import find_parent_cycle_members

BridgeOutcome = Literal["inherited", "dissolved"]


def compute_member_merge_preview(
    db: Session, tree: Tree, keep: Member, remove: Member
) -> MemberMergePreviewOut:
    """Field conflicts plus counts of what a merge would transfer onto ``keep``.

    Conflicts are reported in camelCase (unlike the tree-merge preview, whose
    ``conflicts`` are the raw snake_case attribute names) so the response
    lines up with the frontend's ``RESOLVABLE_FIELDS``/``MergeConflictResolver``
    without a translation layer on the client.
    """
    conflicts = [to_camel(field) for field in compute_conflicts(keep, remove)]
    match = "exact" if member_key(keep) == member_key(remove) else "possible"
    pair = DuplicatePair(
        member_a=MemberOut.model_validate(keep),
        member_b=MemberOut.model_validate(remove),
        match=match,
        conflicts=conflicts,
        default_action="merge",
    )

    def _count(model: type, column) -> int:
        return db.scalar(select(func.count()).where(column == remove.id)) or 0

    relations = (
        db.scalar(
            select(func.count())
            .select_from(Relation)
            .where(
                Relation.tree_id == tree.id,
                or_(
                    Relation.from_member_id == remove.id,
                    Relation.to_member_id == remove.id,
                ),
            )
        )
        or 0
    )

    transfer = MemberMergeTransferCounts(
        relations=relations,
        events=_count(EventMemberLink, EventMemberLink.member_id),
        stories=_count(StoryMemberLink, StoryMemberLink.member_id),
        gallery=_count(GalleryMemberLink, GalleryMemberLink.member_id),
        documents=_count(DocumentMemberLink, DocumentMemberLink.member_id),
        tasks=_count(MemberTaskLink, MemberTaskLink.member_id),
        diseases=_count(MemberDisease, MemberDisease.member_id),
    )
    return MemberMergePreviewOut(pair=pair, transfer=transfer)


def _repoint_member_links(
    db: Session,
    model: type,
    id_field: str,
    keep_id: str,
    remove_id: str,
    extra_fields: tuple[str, ...] = (),
) -> None:
    """Union a member-link table onto ``keep_id``, dropping duplicates.

    Every content link table (events, stories, gallery, documents, tasks) has
    the same composite-PK shape: ``(<content>_id, member_id)``. A link already
    on ``keep_id`` wins; ``remove_id``'s copy is simply dropped rather than
    causing a primary-key clash.
    """
    keep_ids = {
        getattr(row, id_field)
        for row in db.scalars(select(model).where(model.member_id == keep_id))
    }
    to_add: list[dict] = []
    for row in db.scalars(select(model).where(model.member_id == remove_id)):
        content_id = getattr(row, id_field)
        extras = {field: getattr(row, field) for field in extra_fields}
        db.delete(row)
        if content_id in keep_ids:
            continue
        keep_ids.add(content_id)
        to_add.append({id_field: content_id, "member_id": keep_id, **extras})
    db.flush()
    for kwargs in to_add:
        db.add(model(**kwargs))


def _transfer_diseases(db: Session, keep_id: str, remove_id: str) -> None:
    """Move ``remove``'s disease records onto ``keep``, deduping by name.

    Mirrors the tree-merge dedup policy (``app.services.merge``, diseases
    section): two rows naming the same condition on the same person are
    noise once the two records describe one person, so the duplicate is
    dropped rather than kept alongside.
    """
    keep_names = {
        _norm(d.name)
        for d in db.scalars(
            select(MemberDisease).where(MemberDisease.member_id == keep_id)
        )
    }
    for disease in db.scalars(
        select(MemberDisease).where(MemberDisease.member_id == remove_id)
    ):
        name_key = _norm(disease.name)
        if name_key in keep_names:
            db.delete(disease)
            continue
        keep_names.add(name_key)
        disease.member_id = keep_id
    # Flush now (mirroring _repoint_member_links) so these deletes/updates
    # reach the DB before the caller deletes `remove` — otherwise the FK
    # cascade on that delete can race the still-pending disease writes.
    db.flush()


def merge_members_in_place(
    db: Session,
    tree: Tree,
    keep: Member,
    remove: Member,
    fields: dict[str, str],
) -> tuple[Member, dict, Member | None, BridgeOutcome | None]:
    """Merge ``remove`` into ``keep`` within ``tree``; caller commits.

    Returns ``(keep, activity_details, counterpart, bridge_outcome)`` —
    ``counterpart`` is the bridge-person row in another tree, set only when
    ``remove`` was linked to one; ``bridge_outcome`` says what happened to it
    (``"inherited"`` onto ``keep``, or ``"dissolved"`` because ``keep`` already
    had its own link) so the route can log it and notify that other tree.
    """
    if keep.id == remove.id:
        raise HTTPException(
            status_code=400, detail="Cannot merge a member with itself"
        )

    normalized_fields = {
        snake: choice
        for snake, choice in (
            (_to_snake_case(field), choice) for field, choice in fields.items()
        )
        if snake in CONFLICT_FIELDS
    }

    # --- Cycle guard: simulate folding remove's edges onto keep first -------
    all_relations = list(
        db.scalars(select(Relation).where(Relation.tree_id == tree.id))
    )
    simulated_relations = []
    for r in all_relations:
        f = keep.id if r.from_member_id == remove.id else r.from_member_id
        t = keep.id if r.to_member_id == remove.id else r.to_member_id
        if f == t:
            continue
        simulated_relations.append(
            SimpleNamespace(
                from_member_id=f, to_member_id=t, relation_type=r.relation_type
            )
        )
    remaining_members = [
        m
        for m in db.scalars(select(Member).where(Member.tree_id == tree.id))
        if m.id != remove.id
    ]
    if find_parent_cycle_members(remaining_members, simulated_relations):
        raise HTTPException(
            status_code=400,
            detail="This merge would create a relationship cycle",
        )

    # --- Pre-image for the activity log, captured before any mutation -------
    counterpart: Member | None = (
        db.get(Member, remove.linked_member_id)
        if remove.linked_member_id is not None
        else None
    )
    removed_snapshot = member_delete_snapshot(db, remove, counterpart)["snapshot"]
    keep_before = {field: getattr(keep, field) for field in CONFLICT_FIELDS}

    # --- Field resolution onto keep (keep=clone=ma, remove=mb) --------------
    apply_field_choices(keep, keep, remove, normalized_fields)

    # --- Relations: union onto keep, dedupe, drop self-relations -----------
    keep_keys: set[tuple[str, str, str]] = set()
    remove_relations: list[Relation] = []
    for r in all_relations:
        if remove.id in (r.from_member_id, r.to_member_id):
            remove_relations.append(r)
        else:
            keep_keys.add((r.from_member_id, r.to_member_id, r.relation_type))

    new_relations: list[tuple[str, str, str]] = []
    for r in remove_relations:
        f = keep.id if r.from_member_id == remove.id else r.from_member_id
        t = keep.id if r.to_member_id == remove.id else r.to_member_id
        db.delete(r)
        if f == t:
            continue  # self-relation once both ends fold onto keep
        key = (f, t, r.relation_type)
        if key in keep_keys:
            continue  # keep already has this relation
        keep_keys.add(key)
        new_relations.append(key)
    db.flush()
    for f, t, relation_type in new_relations:
        db.add(
            Relation(
                tree_id=tree.id,
                from_member_id=f,
                to_member_id=t,
                relation_type=relation_type,
            )
        )

    # --- Content links: union onto keep, dedupe ------------------------------
    _repoint_member_links(db, EventMemberLink, "event_id", keep.id, remove.id)
    _repoint_member_links(db, StoryMemberLink, "story_id", keep.id, remove.id)
    _repoint_member_links(
        db,
        GalleryMemberLink,
        "gallery_image_id",
        keep.id,
        remove.id,
        extra_fields=("x", "y", "w", "h"),
    )
    _repoint_member_links(db, DocumentMemberLink, "document_id", keep.id, remove.id)
    _repoint_member_links(db, MemberTaskLink, "task_id", keep.id, remove.id)
    _transfer_diseases(db, keep.id, remove.id)

    # --- Tree-in-tree bridge: carry the link onto keep, else dissolve it ----
    bridge_outcome: BridgeOutcome | None = None
    if counterpart is not None:
        if keep.linked_member_id is None:
            keep.linked_tree_id = remove.linked_tree_id
            keep.linked_member_id = remove.linked_member_id
            counterpart.linked_tree_id = keep.tree_id
            counterpart.linked_member_id = keep.id
            bridge_outcome = "inherited"
        else:
            counterpart.linked_tree_id = None
            counterpart.linked_member_id = None
            bridge_outcome = "dissolved"

    details = {
        "merge": {
            "version": SNAPSHOT_VERSION,
            "keep_id": keep.id,
            "removed": removed_snapshot,
            "keep_before": keep_before,
            "field_choices": normalized_fields,
        }
    }

    db.delete(remove)
    return keep, details, counterpart, bridge_outcome
