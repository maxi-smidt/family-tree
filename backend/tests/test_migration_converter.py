"""Tests for the v2 database-conversion engine (#987)."""

import pytest
from sqlalchemy import func, select

from app.models import (
    Member,
    MigrationConflict,
    MigrationMapping,
    MigrationReport,
    MigrationRun,
    SavedView,
    SavedViewSection,
    Section,
    SectionMember,
    VirtualView,
    VirtualViewSource,
    Workspace,
    WorkspaceMembership,
    WorkspaceSectionGrant,
)
from app.models.identity_link import IdentityLink, IdentityLinkStatus
from app.services.migration.converter import run_conversion
from tests.conftest import (
    add_legacy_bridge_columns,
    add_member,
    make_tree,
    make_user,
    set_legacy_bridge,
    share,
)


@pytest.fixture(autouse=True)
def _legacy_bridge_schema(db):
    """``run_conversion`` always reads the legacy bridge columns (#1021
    removed them from the ORM model, so ``Base.metadata.create_all`` no
    longer creates them) — every test in this module needs them present,
    matching a real not-yet-converted instance's schema."""
    add_legacy_bridge_columns(db)


def _make_run(db) -> MigrationRun:
    run = MigrationRun(
        source_version="1.10.2", target_version="2.0.0", phase="converting"
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _wire_bridge(db, member_a: Member, member_b: Member) -> None:
    set_legacy_bridge(db, member_a.id, member_b.workspace_id, member_b.id)
    set_legacy_bridge(db, member_b.id, member_a.workspace_id, member_a.id)


def _identity_link(db, member_a: Member, member_b: Member) -> IdentityLink:
    a_id, b_id = sorted((member_a.id, member_b.id))
    a_ws = member_a.workspace_id if a_id == member_a.id else member_b.workspace_id
    b_ws = member_b.workspace_id if a_id == member_a.id else member_a.workspace_id
    link = IdentityLink(
        member_a_id=a_id,
        member_b_id=b_id,
        workspace_a_id=a_ws,
        workspace_b_id=b_ws,
        status=IdentityLinkStatus.VERIFIED,
        verification_basis="legacy_dual_write_access",
    )
    db.add(link)
    db.commit()
    return link


def test_standalone_workspace_gets_one_default_section(db, owner):
    tree = make_tree(db, owner, name="Solo Tree")
    add_member(db, tree, "m1")
    add_member(db, tree, "m2")
    run = _make_run(db)

    summary = run_conversion(db, run)

    assert summary.components == 1
    section = db.scalar(select(Section).where(Section.workspace_id == tree.id))
    assert section is not None
    assert section.name == "Solo Tree"
    member_ids = set(
        db.scalars(
            select(SectionMember.member_id).where(SectionMember.section_id == section.id)
        )
    )
    assert member_ids == {"m1", "m2"}

    mapping = db.scalar(
        select(MigrationMapping).where(
            MigrationMapping.run_id == run.id,
            MigrationMapping.source_workspace_id == tree.id,
        )
    )
    assert mapping.is_survivor is True
    assert mapping.target_section_id is None


def test_same_owner_linked_trees_consolidate_and_merge_the_bridge(db, owner):
    big = make_tree(db, owner, name="Big Tree")
    small = make_tree(db, owner, name="Small Tree")
    for i in range(3):
        add_member(db, big, f"big{i}")
    add_member(db, small, "small0")
    bridge_big = add_member(db, big, "bridge-big", first_name="Anna")
    bridge_small = add_member(db, small, "bridge-small", first_name="Anna")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    collaborator = make_user(db, "collab")
    share(db, small, collaborator, role="viewer")

    run = _make_run(db)
    summary = run_conversion(db, run)

    assert summary.workspaces_absorbed == 1
    assert db.get(Workspace, small.id) is None
    survivor = db.get(Workspace, big.id)
    assert survivor is not None

    # bridge_big/bridge_small had no drift, so they collapsed into one row:
    # 3 original big members + the merged bridge person + small0.
    remaining = set(db.scalars(select(Member.id).where(Member.workspace_id == big.id)))
    assert len(remaining) == 5
    assert "bridge-small" not in remaining

    sections = list(db.scalars(select(Section).where(Section.workspace_id == big.id)))
    assert {s.name for s in sections} == {"Big Tree", "Small Tree"}
    small_section = next(s for s in sections if s.name == "Small Tree")

    grant = db.scalar(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == big.id,
            WorkspaceSectionGrant.section_id == small_section.id,
            WorkspaceSectionGrant.user_id == collaborator.id,
        )
    )
    assert grant is not None
    assert grant.role == "viewer"

    report = db.scalar(select(MigrationReport).where(MigrationReport.run_id == run.id))
    assert report is not None
    assert {m["source_workspace_id"] for m in report.workspace_mappings} == {
        big.id,
        small.id,
    }


def test_bridge_pair_drift_creates_a_pending_conflict_and_keeps_one_row(db, owner):
    tree_a = make_tree(db, owner, name="A")
    tree_b = make_tree(db, owner, name="B")
    bridge_a = add_member(db, tree_a, "bridge-a", first_name="Anna")
    bridge_b = add_member(db, tree_b, "bridge-b", first_name="Annie")
    _wire_bridge(db, bridge_a, bridge_b)
    _identity_link(db, bridge_a, bridge_b)

    run = _make_run(db)
    summary = run_conversion(db, run)

    assert summary.bridge_pairs_conflicted == 1
    assert summary.bridge_pairs_merged == 0

    conflict = db.scalar(
        select(MigrationConflict).where(MigrationConflict.run_id == run.id)
    )
    assert conflict is not None
    assert conflict.kind == "bridge_merge"
    assert "first_name" in conflict.conflicting_fields
    assert conflict.blocks_finalization is False

    # Survivor tree is "A" (tie on member count, earlier created_at wins);
    # exactly one merged member row remains, none dangling.
    remaining = list(
        db.scalars(select(Member).where(Member.workspace_id.in_([tree_a.id, tree_b.id])))
    )
    assert len(remaining) == 1
    survivor_member = remaining[0]

    # #1018: the surviving row and a section for its source tree, plus both
    # sides' values for every drifted field, are captured on the conflict —
    # the removed row is gone by now, so this is the only place they survive.
    assert conflict.canonical_member_id == survivor_member.id
    section = db.scalar(select(Section).where(Section.name == "B"))
    assert conflict.source_section_id == section.id
    other_id = conflict.member_b_id if conflict.member_a_id == survivor_member.id else (
        conflict.member_a_id
    )
    assert conflict.field_values["first_name"] == {
        survivor_member.id: "Anna",
        other_id: "Annie",
    }


def test_bridge_pair_photo_drift_is_captured_for_1018(db, owner):
    tree_a = make_tree(db, owner, name="A")
    tree_b = make_tree(db, owner, name="B")
    bridge_a = add_member(
        db, tree_a, "bridge-a", first_name="Anna", image_data="/api/media/a/photo-a.jpg"
    )
    bridge_b = add_member(
        db, tree_b, "bridge-b", first_name="Anna", image_data="/api/media/b/photo-b.jpg"
    )
    _wire_bridge(db, bridge_a, bridge_b)
    _identity_link(db, bridge_a, bridge_b)

    run = _make_run(db)
    run_conversion(db, run)

    conflict = db.scalar(
        select(MigrationConflict).where(MigrationConflict.run_id == run.id)
    )
    assert conflict is not None
    assert conflict.conflicting_fields == []  # no scalar drift, only the photo
    assert len(conflict.conflicting_media) == 1
    media = conflict.conflicting_media[0]
    photos = {"/api/media/a/photo-a.jpg", "/api/media/b/photo-b.jpg"}
    assert media["canonical_member_id"] == conflict.canonical_member_id
    assert media["canonical_image_data"] in photos
    assert media["image_data"] in photos
    assert media["canonical_image_data"] != media["image_data"]


def test_self_linked_member_is_reported_without_forming_an_edge(db, owner):
    tree = make_tree(db, owner)
    member = add_member(db, tree, "m1")
    set_legacy_bridge(db, member.id, tree.id, member.id)
    db.commit()

    run = _make_run(db)
    summary = run_conversion(db, run)

    assert any(issue["reason"] == "self" for issue in summary.invalid_bridge_links)
    # A self-pointer never merges a workspace with itself into some other one.
    assert summary.workspaces_absorbed == 0


def test_run_conversion_is_idempotent_on_replay(db, owner):
    big = make_tree(db, owner, name="Big")
    small = make_tree(db, owner, name="Small")
    add_member(db, big, "big0")
    add_member(db, small, "small0")
    bridge_big = add_member(db, big, "bridge-big")
    bridge_small = add_member(db, small, "bridge-small")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    run = _make_run(db)
    run_conversion(db, run)

    section_count_1 = db.scalar(select(func.count()).select_from(Section))
    mapping_count_1 = db.scalar(
        select(func.count())
        .select_from(MigrationMapping)
        .where(MigrationMapping.run_id == run.id)
    )
    member_count_1 = db.scalar(select(func.count()).select_from(Member))
    report_count_1 = db.scalar(select(func.count()).select_from(MigrationReport))

    summary_2 = run_conversion(db, run)

    assert summary_2.workspaces_absorbed == 0
    assert summary_2.bridge_pairs_merged == 0
    assert db.scalar(select(func.count()).select_from(Section)) == section_count_1
    assert (
        db.scalar(
            select(func.count())
            .select_from(MigrationMapping)
            .where(MigrationMapping.run_id == run.id)
        )
        == mapping_count_1
    )
    assert db.scalar(select(func.count()).select_from(Member)) == member_count_1
    assert db.scalar(select(func.count()).select_from(MigrationReport)) == report_count_1


def test_asymmetric_legacy_pointer_does_not_merge_unrelated_workspaces(db, owner):
    tree_a = make_tree(db, owner, name="A")
    tree_b = make_tree(db, owner, name="B")
    member_a = add_member(db, tree_a, "m-a")
    member_b = add_member(db, tree_b, "m-b")

    # One-way pointer: a points at b, b never points back.
    set_legacy_bridge(db, member_a.id, tree_b.id, member_b.id)
    db.commit()
    # Simulates the alembic backfill, which turns even a one-way pointer
    # into an identity link (it only requires one side to resolve).
    _identity_link(db, member_a, member_b)

    run = _make_run(db)
    summary = run_conversion(db, run)

    assert summary.components == 2
    assert db.get(Workspace, tree_a.id) is not None
    assert db.get(Workspace, tree_b.id) is not None
    assert any(issue["reason"] == "asymmetric" for issue in summary.invalid_bridge_links)


def test_survivors_own_membership_is_scoped_to_its_own_section_only(db, owner):
    big = make_tree(db, owner, name="Big")
    small = make_tree(db, owner, name="Small")
    add_member(db, big, "big0")
    add_member(db, small, "small0")
    bridge_big = add_member(db, big, "bridge-big")
    bridge_small = add_member(db, small, "bridge-small")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    # Shared only on the survivor's own original tree, never on "Small".
    collaborator = make_user(db, "collab")
    share(db, big, collaborator, role="editor")

    run = _make_run(db)
    run_conversion(db, run)

    big_section = db.scalar(
        select(Section).where(Section.workspace_id == big.id, Section.name == "Big")
    )
    small_section = db.scalar(
        select(Section).where(Section.workspace_id == big.id, Section.name == "Small")
    )

    # The old blanket membership is gone...
    assert db.get(WorkspaceMembership, (big.id, collaborator.id)) is None
    # ...replaced by a grant scoped to Big's own section only.
    grant_big = db.scalar(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == big.id,
            WorkspaceSectionGrant.section_id == big_section.id,
            WorkspaceSectionGrant.user_id == collaborator.id,
        )
    )
    assert grant_big is not None
    assert grant_big.role == "editor"

    grant_small = db.scalar(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == big.id,
            WorkspaceSectionGrant.section_id == small_section.id,
            WorkspaceSectionGrant.user_id == collaborator.id,
        )
    )
    assert grant_small is None


def test_user_shared_on_both_constituent_trees_gets_two_scoped_grants(db, owner):
    big = make_tree(db, owner, name="Big")
    small = make_tree(db, owner, name="Small")
    add_member(db, big, "big0")
    add_member(db, small, "small0")
    bridge_big = add_member(db, big, "bridge-big")
    bridge_small = add_member(db, small, "bridge-small")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    collaborator = make_user(db, "collab")
    share(db, big, collaborator, role="viewer")
    share(db, small, collaborator, role="editor")

    run = _make_run(db)
    run_conversion(db, run)

    big_section = db.scalar(
        select(Section).where(Section.workspace_id == big.id, Section.name == "Big")
    )
    small_section = db.scalar(
        select(Section).where(Section.workspace_id == big.id, Section.name == "Small")
    )
    grant_big = db.scalar(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == big.id,
            WorkspaceSectionGrant.section_id == big_section.id,
            WorkspaceSectionGrant.user_id == collaborator.id,
        )
    )
    grant_small = db.scalar(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == big.id,
            WorkspaceSectionGrant.section_id == small_section.id,
            WorkspaceSectionGrant.user_id == collaborator.id,
        )
    )
    assert grant_big is not None and grant_big.role == "viewer"
    assert grant_small is not None and grant_small.role == "editor"


def test_virtual_view_across_a_consolidated_pair_keeps_both_sections(db, owner):
    big = make_tree(db, owner, name="Big")
    small = make_tree(db, owner, name="Small")
    add_member(db, big, "big0")
    add_member(db, small, "small0")
    bridge_big = add_member(db, big, "bridge-big")
    bridge_small = add_member(db, small, "bridge-small")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    view = VirtualView(name="Combined", owner_id=owner.id)
    db.add(view)
    db.flush()
    db.add(VirtualViewSource(view_id=view.id, position=0, workspace_id=big.id))
    db.add(VirtualViewSource(view_id=view.id, position=1, workspace_id=small.id))
    db.commit()

    run = _make_run(db)
    summary = run_conversion(db, run)

    assert summary.virtual_views_dropped == 0
    assert summary.saved_views_converted == 1
    saved_view = db.scalar(select(SavedView).where(SavedView.name == "Combined"))
    assert saved_view is not None
    assert saved_view.workspace_id == big.id
    section_ids = set(
        db.scalars(
            select(SavedViewSection.section_id).where(
                SavedViewSection.saved_view_id == saved_view.id
            )
        )
    )
    # Both constituent trees' sections must survive — deleting "Small" before
    # the view is converted would cascade its VirtualViewSource row away and
    # silently drop it here.
    assert len(section_ids) == 2


def test_replay_hydrates_the_report_after_an_earlier_partial_crash(db, owner):
    survivor = make_tree(db, owner, name="Survivor")
    add_member(db, survivor, "s0")
    run = _make_run(db)

    # Simulate an earlier attempt that already absorbed "Ghost" into
    # survivor and deleted it, but crashed before the report was written.
    ghost_id = "ghost-workspace"
    db.add(Workspace(id=ghost_id, name="Ghost", owner_id=owner.id))
    db.commit()
    db.add(
        MigrationMapping(
            run_id=run.id,
            source_workspace_id=ghost_id,
            source_workspace_name="Ghost",
            target_workspace_id=survivor.id,
            is_survivor=False,
        )
    )
    db.commit()
    db.delete(db.get(Workspace, ghost_id))
    db.commit()

    run_conversion(db, run)

    report = db.scalar(
        select(MigrationReport).where(
            MigrationReport.run_id == run.id, MigrationReport.owner_user_id == owner.id
        )
    )
    assert report is not None
    assert any(m["source_workspace_id"] == ghost_id for m in report.workspace_mappings)
