"""The v2 database conversion engine (#987): the ``converting`` phase body.

Startup locking/backup, filesystem/media conversion (#995), backup restore
(#996), the report UI, and legacy-structure deletion (#1021) are all owned
elsewhere; ``run_conversion`` is the piece #994 invokes in between backup and
media relocation. It:

1. Groups workspaces into same-owner components via the legacy tree-in-tree
   bridge (``Member.linked_workspace_id``/``linked_member_id``), validating
   link symmetry before using an edge, and picks one deterministic survivor
   per component (``_select_survivor``).
2. Gives every workspace exactly one default section holding all of its
   current members, seeds content provenance for its existing content, and —
   for every non-survivor — migrates its membership/invitations/public link
   onto a section-scoped grant, re-points its content onto the survivor, and
   removes the now-empty workspace row.
3. Collapses any identity link (legacy bridge or otherwise) whose two
   endpoints land in the same workspace as a result of step 2, via the
   existing same-tree member-merge machinery, recording a durable conflict
   for #1018 when the pair's fields drift.
4. Converts a virtual view into a saved view when every one of its flattened
   sources now lives in a single workspace, dropping (and reporting) any
   other virtual view.
5. Writes one ``MigrationReport`` per affected workspace owner.

Every step checks for its own prior side effect before writing one (a
``MigrationMapping``/``MigrationIdempotencyKey`` row, an existing grant, an
existing section member, ...), so re-invoking this for the same run after a
crash resumes cleanly instead of duplicating work — see #997's mapping/
idempotency-key contract. The function commits after each self-contained
step so a restart only replays the step that was interrupted.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import column, func, or_, select, table
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    ActivityLog,
    BackgroundJob,
    ContentType,
    Document,
    DocumentFile,
    DocumentUpload,
    Event,
    GalleryImage,
    IdentityLink,
    Member,
    MemberDisease,
    MemberTask,
    MigrationIdempotencyKey,
    MigrationMapping,
    MigrationRun,
    QualityIssueDismissal,
    Relation,
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    Section,
    SectionMember,
    Story,
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
    WorkspaceSectionGrant,
    WorkspaceSectionPublicLink,
    WorkspaceUserState,
)
from app.models.identity_link import IdentityLinkVerificationBasis
from app.models.migration import MigrationConflictKind, MigrationPhase
from app.services import provenance
from app.services.members.member_merge import (
    # Reuse the merge's own cycle guard rather than forking it.
    _merge_creates_cycle_through_keep,
    merge_members_in_place,
)
from app.services.migration import conflicts as conflict_service
from app.services.migration import reports as report_service
from app.services.saved_views.position_conversion import (
    SavedPosition,
    convert_positions,
    fan_out_group,
    group_member_ids,
    primary_member_id,
)
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.grants import VALID_ROLES, create_section_grant
from app.services.workspaces.public_links import create_section_public_link
from app.services.workspaces.quality_checks import issue_id_for

# Content tables that carry a plain ``workspace_id`` column and nothing else
# migration-sensitive (no dedup key, no cross-workspace uniqueness) — every
# row of a non-survivor workspace simply moves onto the survivor. Grants,
# invitations, public links, sections, saved views and virtual views are
# deliberately excluded: each needs its own conversion (scoped grant, scoped
# section reference, ...) rather than a blind column repoint.
_WORKSPACE_SCOPED_CONTENT_MODELS: tuple[type, ...] = (
    Member,
    Relation,
    MemberDisease,
    MemberTask,
    GalleryImage,
    Event,
    Story,
    Document,
    DocumentFile,
    DocumentUpload,
    ActivityLog,
    QualityIssueDismissal,
)

_PROVENANCE_MODELS: tuple[tuple[type, ContentType], ...] = (
    (Event, ContentType.EVENT),
    (Story, ContentType.STORY),
    (Document, ContentType.DOCUMENT),
    (GalleryImage, ContentType.GALLERY_IMAGE),
    (MemberTask, ContentType.TASK),
    (MemberDisease, ContentType.DISEASE),
)

# ``Member.linked_workspace_id``/``linked_member_id`` are no longer mapped
# columns (#1021 drops them once conversion has run — see
# ``app.services.migration.legacy_cleanup``), but they still exist in the
# database at the time this module runs, so a plain Core table is used to
# read/write them instead of the ORM model.
_legacy_members = table(
    "members",
    column("id"),
    column("workspace_id"),
    column("linked_workspace_id"),
    column("linked_member_id"),
)

# Person-level fields the legacy bridge person kept mirrored between the two
# rows of a link. Media URLs are tree-scoped (the same photo has a different
# path in each tree), so image_data can't be compared textually and is
# excluded here.
_BRIDGE_DRIFT_FIELDS = {
    "gender",
    "academic_title",
    "first_name",
    "middle_names",
    "baptismal_name",
    "last_name",
    "maiden_name",
    "date_of_birth",
    "date_of_death",
    "deceased",
    "adopted",
    "additional_data",
    "birthplace",
    "hometown",
    "cemetery",
    "places_lived",
}


def _drift_fields(a: Member, b: Member) -> list[str]:
    """Field names on which the two rows of a legacy bridge person disagree.

    Empty string and None are treated as equal — clearing a text field on one
    side only should not count as drift.
    """
    return sorted(
        k
        for k in _BRIDGE_DRIFT_FIELDS
        if (getattr(a, k) or None) != (getattr(b, k) or None)
    )


def _flatten_workspace_ids(
    db: Session, view: VirtualView, _seen: set[str] | None = None
) -> list[str]:
    """Ordered, de-duplicated real workspace ids underlying a virtual view.

    Expands nested virtual-view sources depth-first in source order. Missing
    sources (deleted workspace/view rows) contribute nothing. ``_seen`` tracks
    the current traversal path so a genuine cycle raises; cycles were already
    rejected at write time by the (now-removed) virtual-view router, so this
    is purely defensive.
    """
    if _seen is None:
        _seen = set()
    if view.id in _seen:
        raise ValueError(f"virtual view cycle at {view.id}")
    _seen.add(view.id)

    result: list[str] = []
    for src in view.sources:
        if src.workspace_id is not None:
            if src.workspace_id not in result:
                result.append(src.workspace_id)
        elif src.source_view_id is not None:
            nested = db.get(VirtualView, src.source_view_id)
            if nested is None:
                continue
            for tid in _flatten_workspace_ids(db, nested, _seen):
                if tid not in result:
                    result.append(tid)
    _seen.discard(view.id)
    return result


@dataclass
class ConversionSummary:
    components: int = 0
    sections_created: int = 0
    workspaces_absorbed: int = 0
    bridge_pairs_merged: int = 0
    bridge_pairs_conflicted: int = 0
    invalid_bridge_links: list[dict] = field(default_factory=list)
    saved_views_converted: int = 0
    virtual_views_dropped: int = 0
    reports_written: int = 0


# ---------------------------------------------------------------------------
# Idempotency-key helpers (#997)
# ---------------------------------------------------------------------------


def _idempotent_target(db: Session, run_id: str, key: str) -> str | None:
    row = db.get(MigrationIdempotencyKey, (run_id, MigrationPhase.CONVERTING, key))
    return row.target_id if row is not None else None


def _record_idempotent(
    db: Session, run_id: str, key: str, *, target_type: str, target_id: str
) -> None:
    db.add(
        MigrationIdempotencyKey(
            run_id=run_id,
            phase=MigrationPhase.CONVERTING,
            key=key,
            target_type=target_type,
            target_id=target_id,
        )
    )


# ---------------------------------------------------------------------------
# Step 1: same-owner components over the legacy tree-in-tree bridge
# ---------------------------------------------------------------------------


def _classify_legacy_bridge_links(
    db: Session,
) -> tuple[set[tuple[str, str]], list[dict]]:
    """Classify every legacy ``Member.linked_workspace_id`` pointer.

    Returns ``(valid_pairs, issues)``: ``valid_pairs`` holds every
    canonically ordered ``(member_a_id, member_b_id)`` whose pointer is
    reciprocal and workspace-consistent on both sides — the *only* pairs
    eligible to union two workspaces into one same-owner component (see
    ``_same_owner_components``). ``issues`` lists the ``self``/``dangling``/
    ``asymmetric`` pointers for the owner-facing report; a one-way pointer
    must never merge two otherwise-unrelated workspaces just because the
    alembic conversion (over-)eagerly turned it into an identity link.
    """
    issues: list[dict] = []
    valid_pairs: set[tuple[str, str]] = set()
    linked = {
        row.id: row
        for row in db.execute(
            select(_legacy_members).where(_legacy_members.c.linked_member_id.isnot(None))
        )
    }
    for member in linked.values():
        if member.linked_workspace_id == member.workspace_id:
            issues.append(
                {
                    "reason": "self",
                    "workspace_id": member.workspace_id,
                    "member_id": member.id,
                }
            )
            continue
        counterpart = linked.get(member.linked_member_id)
        if counterpart is None:
            counterpart = db.execute(
                select(_legacy_members).where(
                    _legacy_members.c.id == member.linked_member_id
                )
            ).first()
        if counterpart is None or counterpart.workspace_id != member.linked_workspace_id:
            issues.append(
                {
                    "reason": "dangling",
                    "workspace_id": member.workspace_id,
                    "member_id": member.id,
                }
            )
            continue
        if (
            counterpart.linked_member_id != member.id
            or counterpart.linked_workspace_id != member.workspace_id
        ):
            issues.append(
                {
                    "reason": "asymmetric",
                    "workspace_id": member.workspace_id,
                    "member_id": member.id,
                }
            )
            continue
        valid_pairs.add(tuple(sorted((member.id, counterpart.id))))
    return valid_pairs, issues


def _same_owner_components(
    db: Session, valid_pairs: set[tuple[str, str]]
) -> list[list[Workspace]]:
    """Every workspace, grouped into same-owner components.

    A standalone workspace forms its own singleton component (rule 1: every
    tree gets a workspace with one section). Edges come from *verified*
    legacy identity links (``verification_basis=legacy_dual_write_access``)
    between two workspaces sharing an owner, restricted to ``valid_pairs`` —
    a link the alembic conversion created from a self/dangling/asymmetric
    legacy pointer (see ``_classify_legacy_bridge_links``) never represents a
    genuine mutual tree-in-tree link, so it must not union two otherwise
    unrelated workspaces into one destructively-consolidated component.
    """
    workspaces = list(db.scalars(select(Workspace)))
    by_id = {w.id: w for w in workspaces}
    parent: dict[str, str] = {w.id: w.id for w in workspaces}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: str, y: str) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    links = db.scalars(
        select(IdentityLink).where(
            IdentityLink.verification_basis
            == IdentityLinkVerificationBasis.LEGACY_DUAL_WRITE_ACCESS
        )
    )
    for link in links:
        if tuple(sorted((link.member_a_id, link.member_b_id))) not in valid_pairs:
            continue
        a = by_id.get(link.workspace_a_id)
        b = by_id.get(link.workspace_b_id)
        if a is None or b is None or a.owner_id != b.owner_id:
            continue
        union(a.id, b.id)

    groups: dict[str, list[Workspace]] = defaultdict(list)
    for w in workspaces:
        groups[find(w.id)].append(w)
    return list(groups.values())


def _select_survivor(db: Session, workspaces: list[Workspace]) -> tuple[Workspace, dict]:
    """Deterministic survivor: most members, then oldest, then smallest id."""
    counts = {
        w.id: db.scalar(
            select(func.count()).select_from(Member).where(Member.workspace_id == w.id)
        )
        or 0
        for w in workspaces
    }
    ranked = sorted(workspaces, key=lambda w: (-counts[w.id], w.created_at, w.id))
    tie_break = {
        "candidates": [
            {
                "workspace_id": w.id,
                "member_count": counts[w.id],
                "created_at": w.created_at,
            }
            for w in ranked
        ]
    }
    return ranked[0], tie_break


def _ensure_mapping(
    db: Session,
    run_id: str,
    source: Workspace,
    *,
    target_workspace_id: str,
    is_survivor: bool,
    tie_break: dict,
) -> MigrationMapping:
    existing = db.scalar(
        select(MigrationMapping).where(
            MigrationMapping.run_id == run_id,
            MigrationMapping.source_workspace_id == source.id,
        )
    )
    if existing is not None:
        return existing
    mapping = MigrationMapping(
        run_id=run_id,
        source_workspace_id=source.id,
        source_workspace_name=source.name,
        target_workspace_id=target_workspace_id,
        is_survivor=is_survivor,
        tie_break_inputs=tie_break,
    )
    db.add(mapping)
    try:
        with UnitOfWork(db):
            pass
    except IntegrityError:
        existing = db.scalar(
            select(MigrationMapping).where(
                MigrationMapping.run_id == run_id,
                MigrationMapping.source_workspace_id == source.id,
            )
        )
        if existing is None:
            raise
        return existing
    return mapping


# ---------------------------------------------------------------------------
# Step 2: default sections, provenance, access, content repoint
# ---------------------------------------------------------------------------


def _unique_section_name(db: Session, workspace_id: str, desired: str) -> str:
    base = desired.strip() or "Untitled"
    existing = set(
        db.scalars(
            select(Section.name_normalized).where(Section.workspace_id == workspace_id)
        )
    )
    candidate = base
    suffix = 2
    while candidate.strip().lower() in existing:
        candidate = f"{base} ({suffix})"
        suffix += 1
    return candidate


def _next_section_position(db: Session, workspace_id: str) -> int:
    max_position = db.scalar(
        select(func.max(Section.position)).where(Section.workspace_id == workspace_id)
    )
    return 0 if max_position is None else max_position + 1


def _ensure_default_section(
    db: Session, run_id: str, target_workspace: Workspace, source_workspace: Workspace
) -> Section:
    key = f"section:{source_workspace.id}"
    existing_id = _idempotent_target(db, run_id, key)
    if existing_id is not None:
        section = db.get(Section, existing_id)
        if section is not None:
            return section
    section = Section(
        workspace_id=target_workspace.id,
        name=_unique_section_name(db, target_workspace.id, source_workspace.name),
        position=_next_section_position(db, target_workspace.id),
    )
    db.add(section)
    db.flush()
    _record_idempotent(db, run_id, key, target_type="section", target_id=section.id)
    with UnitOfWork(db):
        pass
    return section


def _assign_section_members(
    db: Session, section: Section, source_workspace_id: str
) -> list[str]:
    member_ids = list(
        db.scalars(select(Member.id).where(Member.workspace_id == source_workspace_id))
    )
    already = set(
        db.scalars(
            select(SectionMember.member_id).where(SectionMember.section_id == section.id)
        )
    )
    for member_id in member_ids:
        if member_id not in already:
            db.add(SectionMember(section_id=section.id, member_id=member_id))
    with UnitOfWork(db):
        pass
    return member_ids


def _seed_provenance(
    db: Session, workspace_id: str, section_id: str, source_workspace_id: str
) -> None:
    for model, content_type in _PROVENANCE_MODELS:
        for content_id in db.scalars(
            select(model.id).where(model.workspace_id == source_workspace_id)
        ):
            provenance.record_scope(
                db,
                workspace_id=workspace_id,
                content_type=content_type,
                content_id=content_id,
                section_id=section_id,
            )
    with UnitOfWork(db):
        pass


def _scope_legacy_access(
    db: Session, source: Workspace, survivor: Workspace, section: Section
) -> list[dict]:
    """Convert ``source``'s legacy whole-workspace access into grants/links
    scoped to ``section`` on ``survivor``, so consolidation cannot change
    anyone's visibility.

    Applies to the survivor's *own* pre-existing membership/invitations/
    public link too, not only a non-survivor being absorbed: before
    consolidation, the survivor *was* a single tree, so a collaborator's
    ``WorkspaceMembership`` on it only ever covered that one tree's content.
    Leaving that membership workspace-wide after consolidation would silently
    hand them every newly-absorbed section for free, and leaving
    ``Workspace.public_role`` set would do the same for anonymous access —
    both are access widening the migration must not perform. Each legacy
    membership is therefore replaced outright by an equivalent section grant
    (deleting the ``WorkspaceMembership`` row), independently for the
    survivor and for every other constituent workspace, so a user shared on
    two of them ends up with two section grants — their original role and
    restrictions preserved on each — rather than one grant silently winning.
    """
    changes: list[dict] = []
    for membership in list(
        db.scalars(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == source.id
            )
        )
    ):
        existing = db.scalar(
            select(WorkspaceSectionGrant.id).where(
                WorkspaceSectionGrant.workspace_id == survivor.id,
                WorkspaceSectionGrant.section_id == section.id,
                WorkspaceSectionGrant.user_id == membership.user_id,
            )
        )
        if existing is None:
            create_section_grant(
                db,
                workspace_id=survivor.id,
                section_id=section.id,
                user_id=membership.user_id,
                role=membership.role,
                restrictions=membership.restrictions,
            )
            changes.append(
                {
                    "user_id": membership.user_id,
                    "role": membership.role
                    if membership.role in VALID_ROLES
                    else "viewer",
                    "section_id": section.id,
                    "source_workspace_id": source.id,
                }
            )
        db.delete(membership)

    for invitation in db.scalars(
        select(WorkspaceInvitation).where(WorkspaceInvitation.workspace_id == source.id)
    ):
        invitation.workspace_id = survivor.id
        if invitation.section_id is None:
            invitation.section_id = section.id

    if source.public_role is not None:
        already = db.scalar(
            select(WorkspaceSectionPublicLink.id).where(
                WorkspaceSectionPublicLink.workspace_id == survivor.id,
                WorkspaceSectionPublicLink.section_id == section.id,
            )
        )
        if already is None:
            link = create_section_public_link(
                db,
                workspace_id=survivor.id,
                section_id=section.id,
                role=source.public_role,
            )
            db.flush()
            link.password_hash = source.public_password_hash
            link.access_version = source.public_access_version
            changes.append(
                {
                    "public_link": True,
                    "section_id": section.id,
                    "source_workspace_id": source.id,
                }
            )
        # The workspace-wide toggle is now redundant with (and, if left set,
        # wider than) the section-scoped link above.
        source.public_role = None
        source.public_password_hash = None
    with UnitOfWork(db):
        pass
    return changes


def _dedupe_user_states(db: Session, source_id: str, target_id: str) -> None:
    target_by_user = {
        s.user_id: s
        for s in db.scalars(
            select(WorkspaceUserState).where(WorkspaceUserState.workspace_id == target_id)
        )
    }
    for state in list(
        db.scalars(
            select(WorkspaceUserState).where(WorkspaceUserState.workspace_id == source_id)
        )
    ):
        existing = target_by_user.get(state.user_id)
        if existing is None:
            state.workspace_id = target_id
            target_by_user[state.user_id] = state
        else:
            if state.last_opened > existing.last_opened:
                existing.last_opened = state.last_opened
            db.delete(state)


def _repoint_content(db: Session, source_id: str, target_id: str) -> None:
    for model in _WORKSPACE_SCOPED_CONTENT_MODELS:
        db.query(model).filter(model.workspace_id == source_id).update(
            {model.workspace_id: target_id}, synchronize_session=False
        )
    db.execute(
        _legacy_members.update()
        .where(_legacy_members.c.linked_workspace_id == source_id)
        .values(linked_workspace_id=target_id)
    )
    db.query(BackgroundJob).filter(BackgroundJob.result_workspace_id == source_id).update(
        {BackgroundJob.result_workspace_id: target_id}, synchronize_session=False
    )
    _dedupe_user_states(db, source_id, target_id)
    db.flush()


def _absorb_workspace(
    db: Session, run_id: str, source: Workspace, survivor: Workspace
) -> Section:
    section = _ensure_default_section(db, run_id, survivor, source)
    # Captured before any bridge collapse below, so a boundary person (about
    # to be merged away as "remove") is still recorded as a member of this
    # section — merge_members_in_place's own SectionMember repoint then
    # carries that membership onto "keep" (see _collapse_pair).
    _assign_section_members(db, section, source.id)
    _seed_provenance(db, survivor.id, section.id, source.id)
    return section


# ---------------------------------------------------------------------------
# Step 3: bridge-pair collapse
# ---------------------------------------------------------------------------


def _prepare_bridge_collapses(
    db: Session, source_id: str, target_id: str
) -> list[tuple[str, str]]:
    """Detach every identity link touching ``source_id`` before its members'
    ``workspace_id`` moves to ``target_id``.

    ``IdentityLink`` carries a composite FK into ``members (workspace_id,
    id)``, so bulk-repointing ``Member.workspace_id`` (see ``_repoint_
    content``) would break it for any row still naming the old workspace. A
    link to some other, not-yet-absorbed workspace simply follows its member
    onto ``target_id`` here. A link whose *other* side is already
    ``target_id`` is a same-final-workspace bridge pair — leaving it in place
    would violate ``ck_identity_link_no_same_workspace`` the moment both
    sides read ``target_id``, so it is deleted here and returned as a
    ``(keep_id, remove_id)`` pair for the caller to merge once the repoint
    below has moved both member rows (and their relations/content) into the
    same workspace.
    """
    to_collapse: list[tuple[str, str]] = []
    links = list(
        db.scalars(
            select(IdentityLink).where(
                or_(
                    IdentityLink.workspace_a_id == source_id,
                    IdentityLink.workspace_b_id == source_id,
                )
            )
        )
    )
    for link in links:
        source_is_a = link.workspace_a_id == source_id
        other_side = link.workspace_b_id if source_is_a else link.workspace_a_id
        if other_side == target_id:
            keep_id = link.member_b_id if source_is_a else link.member_a_id
            remove_id = link.member_a_id if source_is_a else link.member_b_id
            to_collapse.append((keep_id, remove_id))
            db.delete(link)
        elif source_is_a:
            link.workspace_a_id = target_id
        else:
            link.workspace_b_id = target_id
    db.flush()
    return to_collapse


def _collapse_pair(
    db: Session,
    run: MigrationRun,
    workspace: Workspace,
    keep_id: str,
    remove_id: str,
    source_section_id: str | None,
) -> str:
    """Merge ``remove_id`` into ``keep_id`` (both already in ``workspace``).

    Returns ``"merged"`` (no drift), ``"conflict"`` (drift recorded for
    #1018), or ``"cycle"`` (left unmerged — see below).
    """
    keep = db.get(Member, keep_id)
    remove = db.get(Member, remove_id)
    if keep is None or remove is None:
        return "skipped"  # one side already gone via an earlier collapse

    relations = list(
        db.scalars(select(Relation).where(Relation.workspace_id == workspace.id))
    )
    if _merge_creates_cycle_through_keep(relations, keep.id, remove.id):
        # The identity link is already gone (see _prepare_bridge_collapses)
        # and a same-workspace link can never be recreated, so a blocking
        # conflict is the only way left to keep this pair visible for manual
        # resolution instead of silently losing the "same person" fact. Both
        # rows are still live (the merge below never ran), so there is no
        # canonical survivor yet — resolving this conflict is a #1021+ concern,
        # not #1018's field/photo application.
        conflict_service.create_conflict(
            db,
            run_id=run.id,
            kind=MigrationConflictKind.BRIDGE_MERGE,
            owner_user_id=workspace.owner_id,
            workspace_id=workspace.id,
            source_section_id=source_section_id,
            member_a_id=min(keep_id, remove_id),
            member_b_id=max(keep_id, remove_id),
            canonical_member_id=None,
            conflicting_fields=["__cycle__"],
            field_values={},
            conflicting_media=[],
            blocks_finalization=True,
        )
        return "cycle"

    # Captured before merge_members_in_place deletes `remove` below — its
    # field values are otherwise unrecoverable, and #1018's resolution needs
    # both sides to present the canonical value beside each alternative.
    drift = _drift_fields(keep, remove)
    field_values = {
        field: {keep.id: getattr(keep, field), remove.id: getattr(remove, field)}
        for field in drift
    }
    conflicting_media = (
        [
            {
                "member_id": remove.id,
                "image_data": remove.image_data,
                "canonical_member_id": keep.id,
                "canonical_image_data": keep.image_data,
            }
        ]
        if (keep.image_data or None) != (remove.image_data or None)
        else []
    )
    merge_members_in_place(db, workspace, keep, remove, fields={})
    _fixup_quality_dismissals(db, workspace.id, keep_id, remove_id)

    if drift or conflicting_media:
        conflict_service.create_conflict(
            db,
            run_id=run.id,
            kind=MigrationConflictKind.BRIDGE_MERGE,
            owner_user_id=workspace.owner_id,
            workspace_id=workspace.id,
            source_section_id=source_section_id,
            member_a_id=min(keep_id, remove_id),
            member_b_id=max(keep_id, remove_id),
            canonical_member_id=keep.id,
            conflicting_fields=drift,
            field_values=field_values,
            conflicting_media=conflicting_media,
            blocks_finalization=False,
        )
        return "conflict"
    return "merged"


def _fixup_quality_dismissals(
    db: Session, workspace_id: str, keep_id: str, remove_id: str
) -> None:
    for dismissal in list(
        db.scalars(
            select(QualityIssueDismissal).where(
                QualityIssueDismissal.workspace_id == workspace_id
            )
        )
    ):
        member_ids = json.loads(dismissal.member_ids)
        if remove_id not in member_ids:
            continue
        new_ids = sorted({keep_id if m == remove_id else m for m in member_ids})
        new_issue_id = issue_id_for(dismissal.issue_type, new_ids)
        duplicate = db.scalar(
            select(QualityIssueDismissal.id).where(
                QualityIssueDismissal.workspace_id == workspace_id,
                QualityIssueDismissal.issue_id == new_issue_id,
                QualityIssueDismissal.id != dismissal.id,
            )
        )
        if duplicate is not None:
            db.delete(dismissal)
            continue
        dismissal.member_ids = json.dumps(new_ids)
        dismissal.issue_id = new_issue_id
    db.flush()


# ---------------------------------------------------------------------------
# Step 4: virtual views -> saved views
# ---------------------------------------------------------------------------


def _convert_virtual_views(
    db: Session,
    run: MigrationRun,
    workspace_target: dict[str, str],
    section_of: dict[str, str],
) -> tuple[list[dict], list[dict], dict[str, dict[str, list[dict]]]]:
    converted: list[dict] = []
    dropped: list[dict] = []
    by_owner: dict[str, dict[str, list[dict]]] = defaultdict(
        lambda: {"converted": [], "dropped": []}
    )

    for view in list(db.scalars(select(VirtualView))):
        source_ids = _flatten_workspace_ids(db, view)
        if not source_ids:
            continue
        targets = {workspace_target.get(sid, sid) for sid in source_ids}
        if len(targets) != 1:
            info = {
                "virtual_view_id": view.id,
                "name": view.name,
                "reason": "spans_multiple_workspaces",
            }
            dropped.append(info)
            by_owner[view.owner_id]["dropped"].append(info)
            for sid in source_ids:
                target_ws = db.get(Workspace, workspace_target.get(sid, sid))
                if target_ws is not None:
                    by_owner[target_ws.owner_id]["dropped"].append(info)
            continue

        key = f"saved_view:{view.id}"
        if _idempotent_target(db, run.id, key) is not None:
            continue

        target_workspace_id = next(iter(targets))
        section_ids = [section_of[sid] for sid in source_ids if sid in section_of]

        saved_view = SavedView(
            workspace_id=target_workspace_id,
            owner_id=view.owner_id,
            name=view.name,
            focus_member_id=None,
        )
        db.add(saved_view)
        db.flush()
        for section_id in section_ids:
            db.add(
                SavedViewSection(
                    saved_view_id=saved_view.id,
                    section_id=section_id,
                    workspace_id=target_workspace_id,
                )
            )

        positions = list(
            db.scalars(
                select(VirtualViewPosition).where(VirtualViewPosition.view_id == view.id)
            )
        )
        direct, anchors = convert_positions(positions)
        anchor_by_node = {a.node_id: a for a in anchors}
        for pos in direct:
            db.add(
                SavedViewPosition(
                    saved_view_id=saved_view.id,
                    node_id=pos.node_id,
                    position_x=pos.position_x,
                    position_y=pos.position_y,
                )
            )

        matches = list(
            db.scalars(
                select(VirtualViewMemberMatch).where(
                    VirtualViewMemberMatch.view_id == view.id
                )
            )
        )
        for group_id in {m.group_id for m in matches}:
            member_ids = group_member_ids(matches, group_id)
            primary_id = primary_member_id(matches, group_id)
            if primary_id is None:
                continue
            anchor = anchor_by_node.get(group_id, SavedPosition(group_id, 0.0, 0.0))
            for pos in fan_out_group(anchor, member_ids, primary_id):
                db.add(
                    SavedViewPosition(
                        saved_view_id=saved_view.id,
                        node_id=pos.node_id,
                        position_x=pos.position_x,
                        position_y=pos.position_y,
                    )
                )
            for other_id in sorted(mid for mid in member_ids if mid != primary_id):
                conflict_service.create_conflict(
                    db,
                    run_id=run.id,
                    kind=MigrationConflictKind.VIRTUAL_VIEW_MATCH,
                    owner_user_id=view.owner_id,
                    workspace_id=target_workspace_id,
                    source_section_id=None,
                    member_a_id=min(primary_id, other_id),
                    member_b_id=max(primary_id, other_id),
                    conflicting_fields=[],
                    conflicting_media=[],
                    blocks_finalization=False,
                )

        _record_idempotent(
            db, run.id, key, target_type="saved_view", target_id=saved_view.id
        )
        info = {
            "virtual_view_id": view.id,
            "saved_view_id": saved_view.id,
            "name": view.name,
        }
        converted.append(info)
        by_owner[view.owner_id]["converted"].append(info)
        with UnitOfWork(db):
            pass

    return converted, dropped, by_owner


# ---------------------------------------------------------------------------
# Step 5: per-owner reports
# ---------------------------------------------------------------------------


def _write_reports(
    db: Session,
    run: MigrationRun,
    mappings_by_owner: dict[str, list[dict]],
    grant_changes_by_owner: dict[str, list[dict]],
    view_reports: dict[str, dict[str, list[dict]]],
    validation_summary: dict,
) -> int:
    owner_ids = set(mappings_by_owner) | set(grant_changes_by_owner) | set(view_reports)
    for owner_id in owner_ids:
        report_service.create_report(
            db,
            run_id=run.id,
            owner_user_id=owner_id,
            workspace_mappings=mappings_by_owner.get(owner_id, []),
            grant_changes=grant_changes_by_owner.get(owner_id, []),
            converted_virtual_views=view_reports.get(owner_id, {}).get("converted", []),
            dropped_virtual_views=view_reports.get(owner_id, {}).get("dropped", []),
            media_verification={},
            validation_summary=validation_summary,
        )
    return len(owner_ids)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run_conversion(db: Session, run: MigrationRun) -> ConversionSummary:
    """Run (or safely resume) the database-conversion phase for ``run``.

    Every write below is guarded by an existence check or a persisted
    idempotency key, so calling this again for the same run — after a crash,
    or as the "second startup" no-op case — only ever fills in what an
    earlier attempt did not finish; it never duplicates a workspace, section,
    grant, merge, or report.
    """
    summary = ConversionSummary()
    valid_pairs, summary.invalid_bridge_links = _classify_legacy_bridge_links(db)

    workspace_target: dict[str, str] = {}
    section_of: dict[str, str] = {}
    mappings_by_owner: dict[str, list[dict]] = defaultdict(list)
    grant_changes_by_owner: dict[str, list[dict]] = defaultdict(list)

    # Hydrate state for any source workspace an earlier, crashed attempt at
    # this same run already absorbed and deleted: _same_owner_components
    # below only sees *live* workspace rows, so without this a replay would
    # rebuild workspace_target/section_of missing that source entirely,
    # mis-scope a virtual view spanning it as "spans_multiple_workspaces",
    # and omit it from the report — even though MigrationMapping already
    # durably recorded where it went. A source still live is left for the
    # loop below to (re)discover normally, so it isn't double-added here.
    # grant_changes_by_owner has no equivalent durable record to hydrate
    # from, so a report written after such a replay may omit that source's
    # grant-change entries — the WorkspaceSectionGrant rows themselves are
    # unaffected, this only narrows the report's informational audit list.
    live_workspace_ids = set(db.scalars(select(Workspace.id)))
    for mapping in db.scalars(
        select(MigrationMapping).where(MigrationMapping.run_id == run.id)
    ):
        if mapping.source_workspace_id in live_workspace_ids:
            continue
        workspace_target[mapping.source_workspace_id] = mapping.target_workspace_id
        if mapping.target_section_id is not None:
            section_of[mapping.source_workspace_id] = mapping.target_section_id
        survivor_ws = db.get(Workspace, mapping.target_workspace_id)
        if survivor_ws is not None:
            mappings_by_owner[survivor_ws.owner_id].append(
                {
                    "source_workspace_id": mapping.source_workspace_id,
                    "source_workspace_name": mapping.source_workspace_name,
                    "target_workspace_id": mapping.target_workspace_id,
                    "target_section_id": mapping.target_section_id,
                    "is_survivor": mapping.is_survivor,
                }
            )

    components = _same_owner_components(db, valid_pairs)
    summary.components = len(components)

    # Workspaces are only deleted once every component has been fully
    # absorbed and virtual views converted below: VirtualViewSource.
    # workspace_id cascades on delete, so deleting a source workspace before
    # _convert_virtual_views runs would silently truncate — or mis-scope as
    # single-workspace — any view spanning it.
    pending_deletes: list[Workspace] = []

    for workspaces in components:
        survivor, tie_break = _select_survivor(db, workspaces)
        owner_id = survivor.owner_id
        # Survivor first (so a collapse candidate always finds its
        # already-in-place target-side member), then the rest in a stable
        # order — both needed for "keep = whichever side is already at the
        # target" (see _prepare_bridge_collapses) to be deterministic and
        # reproducible across a replay.
        ordered = [survivor] + sorted(
            (w for w in workspaces if w.id != survivor.id), key=lambda w: w.id
        )
        for source in ordered:
            is_survivor = source.id == survivor.id
            mapping = _ensure_mapping(
                db,
                run.id,
                source,
                target_workspace_id=survivor.id,
                is_survivor=is_survivor,
                tie_break=tie_break,
            )
            workspace_target[source.id] = survivor.id

            section = _absorb_workspace(db, run.id, source, survivor)
            section_of[source.id] = section.id
            # A survivor didn't move anywhere, so its mapping row's
            # target_section_id stays null (see MigrationMapping's docstring)
            # even though it also gets its own default section.
            if not is_survivor and mapping.target_section_id is None:
                mapping.target_section_id = section.id
                with UnitOfWork(db):
                    pass

            # Scoping legacy access applies to the survivor's own
            # pre-existing membership/invitations/public link too — see
            # _scope_legacy_access's docstring for why leaving those
            # workspace-wide would widen access to the newly-absorbed
            # sections.
            grant_changes = _scope_legacy_access(db, source, survivor, section)
            grant_changes_by_owner[owner_id].extend(grant_changes)

            if not is_survivor:
                summary.sections_created += 1

                to_collapse = _prepare_bridge_collapses(db, source.id, survivor.id)
                _repoint_content(db, source.id, survivor.id)
                for keep_id, remove_id in to_collapse:
                    outcome = _collapse_pair(
                        db, run, survivor, keep_id, remove_id, section.id
                    )
                    if outcome == "merged":
                        summary.bridge_pairs_merged += 1
                    elif outcome in ("conflict", "cycle"):
                        summary.bridge_pairs_conflicted += 1

                pending_deletes.append(source)
                with UnitOfWork(db):
                    pass
                summary.workspaces_absorbed += 1

            mappings_by_owner[owner_id].append(
                {
                    "source_workspace_id": source.id,
                    "source_workspace_name": source.name,
                    "target_workspace_id": survivor.id,
                    "target_section_id": None if is_survivor else section.id,
                    "is_survivor": is_survivor,
                }
            )

    converted, dropped, view_reports = _convert_virtual_views(
        db, run, workspace_target, section_of
    )
    summary.saved_views_converted = len(converted)
    summary.virtual_views_dropped = len(dropped)

    for workspace in pending_deletes:
        db.delete(workspace)
    if pending_deletes:
        with UnitOfWork(db):
            pass

    validation_summary = {
        "invalid_bridge_links": summary.invalid_bridge_links,
        "bridge_merges": {
            "auto": summary.bridge_pairs_merged,
            "conflict": summary.bridge_pairs_conflicted,
        },
    }
    summary.reports_written = _write_reports(
        db,
        run,
        mappings_by_owner,
        grant_changes_by_owner,
        view_reports,
        validation_summary,
    )
    return summary
