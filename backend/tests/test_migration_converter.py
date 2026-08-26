"""Tests for the v2 database-conversion engine (#987)."""

from sqlalchemy import func, select

from app.models import (
    Member,
    MigrationConflict,
    MigrationMapping,
    MigrationReport,
    MigrationRun,
    Section,
    SectionMember,
    Workspace,
    WorkspaceSectionGrant,
)
from app.models.identity_link import IdentityLink, IdentityLinkStatus
from app.services.migration.converter import run_conversion
from tests.conftest import add_member, make_tree, make_user, share


def _make_run(db) -> MigrationRun:
    run = MigrationRun(
        source_version="1.10.2", target_version="2.0.0", phase="converting"
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _wire_bridge(db, member_a: Member, member_b: Member) -> None:
    member_a.linked_workspace_id = member_b.workspace_id
    member_a.linked_member_id = member_b.id
    member_b.linked_workspace_id = member_a.workspace_id
    member_b.linked_member_id = member_a.id
    db.commit()


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


def test_self_linked_member_is_reported_without_forming_an_edge(db, owner):
    tree = make_tree(db, owner)
    member = add_member(db, tree, "m1")
    member.linked_workspace_id = tree.id
    member.linked_member_id = member.id
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
