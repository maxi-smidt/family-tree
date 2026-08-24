"""In-place, same-tree member merge (#729).

Unlike ``app.services.workspaces.merge`` (which clones two whole *workspaces* into a brand
new third tree), this combines two *members of the same tree*: one survives
(``keep``), the other is removed (``remove``) after everything it owns —
relations, content links, diseases, and an optional tree-in-tree bridge — has
been re-pointed onto ``keep``. Field-conflict detection/resolution is reused
from ``app.services.members.member_clone`` rather than forked.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Literal

from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import InvalidInputError
from app.models import (
    DocumentMemberLink,
    Event,
    EventMemberLink,
    GalleryMemberLink,
    Member,
    MemberDisease,
    MemberTaskLink,
    Relation,
    StoryMemberLink,
    Workspace,
)
from app.schemas.family import MemberOut
from app.schemas.merge import (
    DuplicatePair,
    FieldChoice,
    MemberMergePreviewOut,
    MemberMergeTransferCounts,
)
from app.services.activity.activity import SNAPSHOT_VERSION, member_delete_snapshot
from app.services.members.member_clone import (
    CONFLICT_FIELDS,
    apply_field_choices,
    compute_conflicts,
    member_key,
    norm,
    to_snake_case,
)

BridgeOutcome = Literal["inherited", "dissolved"]


def _merge_creates_cycle_through_keep(
    relations: list[Relation], keep_id: str, remove_id: str
) -> bool:
    """Whether folding ``remove``'s parent edges onto ``keep`` makes ``keep``
    its own ancestor.

    Scoped to cycles that would involve ``keep`` specifically — relation
    creation elsewhere has no cycle guard and the quality report treats
    pre-existing cycles as informational, so an unrelated cycle sitting
    somewhere else in the tree must not block this merge (#812).
    """
    parents_of: dict[str, set[str]] = defaultdict(set)
    for r in relations:
        if r.relation_type != "parent":
            continue
        f = keep_id if r.from_member_id == remove_id else r.from_member_id
        t = keep_id if r.to_member_id == remove_id else r.to_member_id
        if f == t:
            continue
        parents_of[f].add(t)

    stack = list(parents_of.get(keep_id, ()))
    seen: set[str] = set()
    while stack:
        node = stack.pop()
        if node == keep_id:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(parents_of.get(node, ()))
    return False


def _plan_relation_transfer(
    all_relations: list[Relation], keep_id: str, remove_id: str
) -> tuple[set[tuple[str, str, str]], list[Relation]]:
    """Split ``all_relations`` into keep's existing dedup keys and the rows
    touching ``remove`` that a merge would need to re-point."""
    keep_keys: set[tuple[str, str, str]] = set()
    remove_relations: list[Relation] = []
    for r in all_relations:
        if remove_id in (r.from_member_id, r.to_member_id):
            remove_relations.append(r)
        else:
            keep_keys.add((r.from_member_id, r.to_member_id, r.relation_type))
    return keep_keys, remove_relations


def _new_relation_keys(
    remove_relations: list[Relation],
    keep_keys: set[tuple[str, str, str]],
    keep_id: str,
    remove_id: str,
) -> list[tuple[str, str, str]]:
    """Dedup keys for the relations a merge would actually add onto keep —
    self-relations and rows keep already has are dropped. Shared by the
    preview (counting only) and the real merge (also applying them) so the
    two can't drift apart (#812)."""
    seen = set(keep_keys)
    new_keys: list[tuple[str, str, str]] = []
    for r in remove_relations:
        f = keep_id if r.from_member_id == remove_id else r.from_member_id
        t = keep_id if r.to_member_id == remove_id else r.to_member_id
        if f == t:
            continue  # self-relation once both ends fold onto keep
        key = (f, t, r.relation_type)
        if key in seen:
            continue  # keep already has this relation
        seen.add(key)
        new_keys.append(key)
    return new_keys


def _count_new_links(
    db: Session, model: type, id_field: str, keep_id: str, remove_id: str
) -> int:
    """How many of remove's rows in a member-link table are not already on
    keep — mirrors the dedup ``_repoint_member_links`` applies at merge time."""
    keep_ids = {
        getattr(row, id_field)
        for row in db.scalars(select(model).where(model.member_id == keep_id))
    }
    return sum(
        1
        for row in db.scalars(select(model).where(model.member_id == remove_id))
        if getattr(row, id_field) not in keep_ids
    )


def _count_new_event_links(
    db: Session, workspace_id: str, keep_id: str, remove_id: str
) -> int:
    """Like ``_count_new_links`` for events, but also excludes a remove-side
    birth/death mirror event when keep already has one of that type — the
    post-merge vital-event dedup (see the merge route) would collapse it
    right back out, so counting it as "will transfer" overstates reality."""
    keep_links = {
        row.event_id
        for row in db.scalars(
            select(EventMemberLink).where(EventMemberLink.member_id == keep_id)
        )
    }
    keep_vital_types = {
        event_type
        for (event_type,) in db.execute(
            select(Event.event_type)
            .join(EventMemberLink, EventMemberLink.event_id == Event.id)
            .where(
                Event.workspace_id == workspace_id,
                EventMemberLink.member_id == keep_id,
                Event.event_type.in_(("birth", "death")),
            )
        )
    }
    count = 0
    for link in db.scalars(
        select(EventMemberLink).where(EventMemberLink.member_id == remove_id)
    ):
        if link.event_id in keep_links:
            continue
        event = db.get(Event, link.event_id)
        if event is not None and event.event_type in keep_vital_types:
            continue
        count += 1
    return count


def _count_new_diseases(db: Session, keep_id: str, remove_id: str) -> int:
    """Mirrors ``_transfer_diseases``'s name-based dedup (including among
    remove's own rows) to count how many diseases would actually transfer."""
    keep_names = {
        norm(d.name)
        for d in db.scalars(
            select(MemberDisease).where(MemberDisease.member_id == keep_id)
        )
    }
    seen = set(keep_names)
    count = 0
    for disease in db.scalars(
        select(MemberDisease).where(MemberDisease.member_id == remove_id)
    ):
        name_key = norm(disease.name)
        if name_key in seen:
            continue
        seen.add(name_key)
        count += 1
    return count


def compute_member_merge_preview(
    db: Session, tree: Workspace, keep: Member, remove: Member
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

    all_relations = list(
        db.scalars(select(Relation).where(Relation.workspace_id == tree.id))
    )
    would_create_cycle = _merge_creates_cycle_through_keep(
        all_relations, keep.id, remove.id
    )
    keep_keys, remove_relations = _plan_relation_transfer(
        all_relations, keep.id, remove.id
    )
    relations = len(_new_relation_keys(remove_relations, keep_keys, keep.id, remove.id))

    transfer = MemberMergeTransferCounts(
        relations=relations,
        events=_count_new_event_links(db, tree.id, keep.id, remove.id),
        stories=_count_new_links(db, StoryMemberLink, "story_id", keep.id, remove.id),
        gallery=_count_new_links(
            db, GalleryMemberLink, "gallery_image_id", keep.id, remove.id
        ),
        documents=_count_new_links(
            db, DocumentMemberLink, "document_id", keep.id, remove.id
        ),
        tasks=_count_new_links(db, MemberTaskLink, "task_id", keep.id, remove.id),
        diseases=_count_new_diseases(db, keep.id, remove.id),
    )
    return MemberMergePreviewOut(
        pair=pair, transfer=transfer, would_create_cycle=would_create_cycle
    )


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

    Mirrors the tree-merge dedup policy
    (``app.services.workspaces.merge_copy.copy_diseases``):
    two rows naming the same condition on the same person are
    noise once the two records describe one person, so the duplicate is
    dropped rather than kept alongside.
    """
    keep_names = {
        norm(d.name)
        for d in db.scalars(
            select(MemberDisease).where(MemberDisease.member_id == keep_id)
        )
    }
    for disease in db.scalars(
        select(MemberDisease).where(MemberDisease.member_id == remove_id)
    ):
        name_key = norm(disease.name)
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
    tree: Workspace,
    keep: Member,
    remove: Member,
    fields: dict[str, FieldChoice],
) -> tuple[Member, dict, Member | None, BridgeOutcome | None]:
    """Merge ``remove`` into ``keep`` within ``tree``; caller commits.

    Returns ``(keep, activity_details, counterpart, bridge_outcome)`` —
    ``counterpart`` is the bridge-person row in another tree, set only when
    ``remove`` was linked to one; ``bridge_outcome`` says what happened to it
    (``"inherited"`` onto ``keep``, or ``"dissolved"`` because ``keep`` already
    had its own link) so the route can log it and notify that other tree.
    """
    if keep.id == remove.id:
        raise InvalidInputError("Cannot merge a member with itself")

    normalized_fields: dict[str, FieldChoice] = {
        snake: choice
        for snake, choice in (
            (to_snake_case(field), choice) for field, choice in fields.items()
        )
        if snake in CONFLICT_FIELDS
    }

    # --- Cycle guard: scoped to cycles that would involve keep --------------
    all_relations = list(
        db.scalars(select(Relation).where(Relation.workspace_id == tree.id))
    )
    if _merge_creates_cycle_through_keep(all_relations, keep.id, remove.id):
        raise InvalidInputError("This merge would make this member their own ancestor")

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
    keep_keys, remove_relations = _plan_relation_transfer(
        all_relations, keep.id, remove.id
    )
    new_relations = _new_relation_keys(remove_relations, keep_keys, keep.id, remove.id)
    for r in remove_relations:
        db.delete(r)
    db.flush()
    for f, t, relation_type in new_relations:
        db.add(
            Relation(
                workspace_id=tree.id,
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

    # --- Workspace-in-tree bridge: carry the link onto keep, else dissolve it ----
    bridge_outcome: BridgeOutcome | None = None
    if counterpart is not None:
        if keep.linked_member_id is None:
            keep.linked_workspace_id = remove.linked_workspace_id
            keep.linked_member_id = remove.linked_member_id
            counterpart.linked_workspace_id = keep.workspace_id
            counterpart.linked_member_id = keep.id
            bridge_outcome = "inherited"
        else:
            counterpart.linked_workspace_id = None
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
