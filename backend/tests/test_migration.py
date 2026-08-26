"""Tests for durable v2 migration state (#997) — models, state machine, and
the owner/admin APIs in app.api.routes.migration."""

import pytest
from sqlalchemy.orm import Session

from app.core.exceptions import AccessDeniedError, ConflictError, InvalidInputError
from app.models.migration import (
    MigrationConflict,
    MigrationConflictStatus,
    MigrationMapping,
    MigrationPhase,
    MigrationReport,
    MigrationRun,
    MigrationStatus,
)
from app.models.user import User
from app.services.migration import conflicts as conflict_service
from app.services.migration import reports as report_service
from app.services.migration.state_machine import (
    advance_phase,
    finalize_run,
    transition_status,
)
from tests.conftest import API, add_member, auth, make_tree, make_user


def _make_run(db: Session, **kw) -> MigrationRun:
    run = MigrationRun(source_version="1.10.2", target_version="2.0.0", **kw)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


# --- state machine -----------------------------------------------------------


def test_advance_phase_moves_forward_one_step_at_a_time(db):
    run = _make_run(db)
    advance_phase(db, run.id, MigrationPhase.BACKUP)
    db.refresh(run)
    assert run.phase == MigrationPhase.BACKUP


def test_advance_phase_rejects_skipping_ahead(db):
    run = _make_run(db)
    with pytest.raises(InvalidInputError):
        advance_phase(db, run.id, MigrationPhase.MEDIA)


def test_advance_phase_rejects_regressing(db):
    run = _make_run(db, phase=MigrationPhase.CONVERTING)
    with pytest.raises(InvalidInputError):
        advance_phase(db, run.id, MigrationPhase.BACKUP)


def test_transition_status_rejects_impossible_regression(db):
    run = _make_run(db, status=MigrationStatus.FINALIZED)
    with pytest.raises(InvalidInputError):
        transition_status(db, run.id, MigrationStatus.RUNNING)


def test_transition_status_running_to_recoverable_to_running(db):
    run = _make_run(db)
    transition_status(db, run.id, MigrationStatus.RECOVERABLE)
    db.refresh(run)
    assert run.status == MigrationStatus.RECOVERABLE
    transition_status(db, run.id, MigrationStatus.RUNNING)
    db.refresh(run)
    assert run.status == MigrationStatus.RUNNING


def test_transition_status_failed_is_terminal(db):
    run = _make_run(db, status=MigrationStatus.FAILED)
    with pytest.raises(InvalidInputError):
        transition_status(db, run.id, MigrationStatus.RUNNING)


def test_transition_status_rejects_completion_before_validating_phase(db):
    run = _make_run(db, phase=MigrationPhase.CONVERTING)
    with pytest.raises(InvalidInputError):
        transition_status(db, run.id, MigrationStatus.COMPLETE)


def test_transition_status_allows_completion_from_validating_phase(db):
    run = _make_run(db, phase=MigrationPhase.VALIDATING)
    completed = transition_status(db, run.id, MigrationStatus.COMPLETE)
    assert completed.status == MigrationStatus.COMPLETE
    assert completed.completed_at is not None


def test_finalize_requires_automated_completion(db):
    run = _make_run(db)  # still "running"
    with pytest.raises(InvalidInputError):
        finalize_run(db, run.id, "admin-id")


def test_finalize_blocks_on_a_blocking_pending_conflict(db, owner):
    run = _make_run(db, status=MigrationStatus.COMPLETE)
    db.add(
        MigrationConflict(
            run_id=run.id,
            kind="bridge_merge",
            owner_user_id=owner.id,
            workspace_id="ws-1",
            member_a_id="m1",
            member_b_id="m2",
            blocks_finalization=True,
        )
    )
    db.commit()
    with pytest.raises(ConflictError):
        finalize_run(db, run.id, owner.id)


def test_finalize_ignores_non_blocking_pending_conflicts(db, owner):
    run = _make_run(db, status=MigrationStatus.COMPLETE)
    db.add(
        MigrationConflict(
            run_id=run.id,
            kind="bridge_merge",
            owner_user_id=owner.id,
            workspace_id="ws-1",
            member_a_id="m1",
            member_b_id="m2",
            blocks_finalization=False,
        )
    )
    db.commit()
    finalized = finalize_run(db, run.id, owner.id)
    assert finalized.status == MigrationStatus.FINALIZED
    assert finalized.finalized_by == owner.id


# --- reports -------------------------------------------------------------


def test_create_report_is_idempotent_per_run_and_owner(db, owner):
    run = _make_run(db)
    kw = dict(
        run_id=run.id,
        owner_user_id=owner.id,
        workspace_mappings=[{"source_workspace_id": "a"}],
        grant_changes=[],
        converted_virtual_views=[],
        dropped_virtual_views=[],
        media_verification={},
        validation_summary={},
    )
    first = report_service.create_report(db, **kw)
    second = report_service.create_report(db, **kw)
    assert first.id == second.id
    assert db.query(MigrationReport).count() == 1


def test_get_report_denies_another_owner(db, owner):
    run = _make_run(db)
    other = make_user(db, "mallory")
    report = report_service.create_report(
        db,
        run_id=run.id,
        owner_user_id=owner.id,
        workspace_mappings=[],
        grant_changes=[],
        converted_virtual_views=[],
        dropped_virtual_views=[],
        media_verification={},
        validation_summary={},
    )
    with pytest.raises(AccessDeniedError):
        report_service.get_report_for_owner(db, report.id, other)


def test_admin_can_read_any_report(db, owner):
    run = _make_run(db)
    admin = make_user(db, "root", is_admin=True)
    report = report_service.create_report(
        db,
        run_id=run.id,
        owner_user_id=owner.id,
        workspace_mappings=[],
        grant_changes=[],
        converted_virtual_views=[],
        dropped_virtual_views=[],
        media_verification={},
        validation_summary={},
    )
    assert report_service.get_report_for_owner(db, report.id, admin).id == report.id


def test_acknowledge_report_is_idempotent(db, owner):
    run = _make_run(db)
    report = report_service.create_report(
        db,
        run_id=run.id,
        owner_user_id=owner.id,
        workspace_mappings=[],
        grant_changes=[],
        converted_virtual_views=[],
        dropped_virtual_views=[],
        media_verification={},
        validation_summary={},
    )
    once = report_service.acknowledge_report(db, report, owner)
    twice = report_service.acknowledge_report(db, once, owner)
    assert once.acknowledged_at == twice.acknowledged_at


def test_resolve_legacy_workspace_id_returns_the_mapped_target(db):
    run = _make_run(db)
    db.add(
        MigrationMapping(
            run_id=run.id,
            source_workspace_id="old-workspace",
            source_workspace_name="Old",
            target_workspace_id="new-workspace",
            is_survivor=False,
        )
    )
    db.commit()
    assert (
        report_service.resolve_legacy_workspace_id(db, "old-workspace")
        == "new-workspace"
    )


def test_resolve_legacy_workspace_id_returns_none_for_an_unknown_id(db):
    assert report_service.resolve_legacy_workspace_id(db, "never-migrated") is None


# --- conflicts -------------------------------------------------------------


def _make_conflict(
    db: Session, run: MigrationRun, owner: User, **kw
) -> MigrationConflict:
    defaults = dict(
        run_id=run.id,
        kind="bridge_merge",
        owner_user_id=owner.id,
        workspace_id="ws-1",
        source_section_id=None,
        member_a_id="m1",
        member_b_id="m2",
        conflicting_fields=["first_name", "birth_date"],
        conflicting_media=[],
    )
    defaults.update(kw)
    return conflict_service.create_conflict(db, **defaults)


def test_create_conflict_is_idempotent_per_pair(db, owner):
    run = _make_run(db)
    first = _make_conflict(db, run, owner)
    second = _make_conflict(db, run, owner)
    assert first.id == second.id
    assert db.query(MigrationConflict).count() == 1


def test_resolve_conflict_records_field_choices(db, owner):
    run = _make_run(db)
    conflict = _make_conflict(db, run, owner)
    resolved = conflict_service.resolve_conflict(
        db, conflict, owner, action="merge", fields={"first_name": "a", "birth_date": "b"}
    )
    assert resolved.status == MigrationConflictStatus.RESOLVED
    assert resolved.resolved_by == owner.id
    assert resolved.resolution == {
        "action": "merge",
        "fields": {"first_name": "a", "birth_date": "b"},
    }


def test_resolve_conflict_rejects_unknown_field(db, owner):
    run = _make_run(db)
    conflict = _make_conflict(db, run, owner)
    with pytest.raises(InvalidInputError):
        conflict_service.resolve_conflict(
            db, conflict, owner, action="merge", fields={"nickname": "a"}
        )


def test_resolve_conflict_replays_the_same_decision(db, owner):
    run = _make_run(db)
    conflict = _make_conflict(db, run, owner)
    first = conflict_service.resolve_conflict(
        db, conflict, owner, action="dismiss", fields={}
    )
    second = conflict_service.resolve_conflict(
        db, conflict, owner, action="dismiss", fields={}
    )
    assert first.resolved_at == second.resolved_at


def test_resolve_conflict_rejects_a_different_decision_once_resolved(db, owner):
    run = _make_run(db)
    conflict = _make_conflict(db, run, owner)
    conflict_service.resolve_conflict(db, conflict, owner, action="dismiss", fields={})
    with pytest.raises(ConflictError):
        conflict_service.resolve_conflict(
            db, conflict, owner, action="merge", fields={"first_name": "a"}
        )


def test_get_conflict_denies_another_owner(db, owner):
    run = _make_run(db)
    other = make_user(db, "mallory")
    conflict = _make_conflict(db, run, owner)
    with pytest.raises(AccessDeniedError):
        conflict_service.get_conflict_for_owner(db, conflict.id, other)


# --- conflict resolution applies to the canonical member (#1018) -----------


def _make_bridge_conflict(db, run, owner, tree, keep, **kw):
    defaults = dict(
        run_id=run.id,
        kind="bridge_merge",
        owner_user_id=owner.id,
        workspace_id=tree.id,
        source_section_id=None,
        member_a_id=keep.id,
        member_b_id="removed-1",
        canonical_member_id=keep.id,
        conflicting_fields=[],
        field_values={},
        conflicting_media=[],
    )
    defaults.update(kw)
    return conflict_service.create_conflict(db, **defaults)


def test_resolve_conflict_merge_applies_the_chosen_alternate_value(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", first_name="Anna")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_fields=["first_name"],
        field_values={"first_name": {keep.id: "Anna", "removed-1": "Annie"}},
    )
    conflict_service.resolve_conflict(
        db, conflict, owner, action="merge", fields={"first_name": "b"}
    )
    db.refresh(keep)
    assert keep.first_name == "Annie"


def test_resolve_conflict_merge_choosing_a_leaves_the_member_unchanged(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", first_name="Anna")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_fields=["first_name"],
        field_values={"first_name": {keep.id: "Anna", "removed-1": "Annie"}},
    )
    conflict_service.resolve_conflict(
        db, conflict, owner, action="merge", fields={"first_name": "a"}
    )
    db.refresh(keep)
    assert keep.first_name == "Anna"


def test_resolve_conflict_merge_combines_text_fields(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", additional_data="Note A")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_fields=["additional_data"],
        field_values={"additional_data": {keep.id: "Note A", "removed-1": "Note B"}},
    )
    conflict_service.resolve_conflict(
        db, conflict, owner, action="merge", fields={"additional_data": "combine"}
    )
    db.refresh(keep)
    assert keep.additional_data == "Note A\n\nNote B"


def test_resolve_conflict_merge_rejects_combine_for_a_non_text_field(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", first_name="Anna")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_fields=["first_name"],
        field_values={"first_name": {keep.id: "Anna", "removed-1": "Annie"}},
    )
    with pytest.raises(InvalidInputError):
        conflict_service.resolve_conflict(
            db, conflict, owner, action="merge", fields={"first_name": "combine"}
        )


def test_resolve_conflict_merge_applies_the_chosen_photo(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", image_data="/api/media/x/a.jpg")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_media=[
            {
                "member_id": "removed-1",
                "image_data": "/api/media/x/b.jpg",
                "canonical_member_id": keep.id,
                "canonical_image_data": "/api/media/x/a.jpg",
            }
        ],
    )
    conflict_service.resolve_conflict(
        db, conflict, owner, action="merge", fields={"image_data": "b"}
    )
    db.refresh(keep)
    assert keep.image_data == "/api/media/x/b.jpg"


def test_resolve_conflict_merge_detects_a_canonical_edit_made_after_migration(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", first_name="Anna")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_fields=["first_name"],
        field_values={"first_name": {keep.id: "Anna", "removed-1": "Annie"}},
    )
    keep.first_name = "Anna-Edited-Post-Migration"
    db.commit()

    with pytest.raises(ConflictError):
        conflict_service.resolve_conflict(
            db, conflict, owner, action="merge", fields={"first_name": "b"}
        )
    db.refresh(keep)
    assert keep.first_name == "Anna-Edited-Post-Migration"


def test_resolve_conflict_merge_replay_does_not_reapply(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", first_name="Anna")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_fields=["first_name"],
        field_values={"first_name": {keep.id: "Anna", "removed-1": "Annie"}},
    )
    fields = {"first_name": "b"}
    conflict_service.resolve_conflict(db, conflict, owner, action="merge", fields=fields)
    db.refresh(keep)
    assert keep.first_name == "Annie"

    # The member's live value no longer matches the captured baseline
    # ("Anna") because the first call already applied "Annie" — an identical
    # replay must short-circuit on the recorded decision rather than
    # re-running the stale-value check against that now-stale baseline.
    again = conflict_service.resolve_conflict(
        db, conflict, owner, action="merge", fields=fields
    )
    assert again.status == MigrationConflictStatus.RESOLVED
    db.refresh(keep)
    assert keep.first_name == "Annie"


def test_resolve_conflict_keep_both_does_not_touch_the_canonical_member(db, owner):
    tree = make_tree(db, owner)
    keep = add_member(db, tree, "keep", first_name="Anna")
    run = _make_run(db)
    conflict = _make_bridge_conflict(
        db,
        run,
        owner,
        tree,
        keep,
        conflicting_fields=["first_name"],
        field_values={"first_name": {keep.id: "Anna", "removed-1": "Annie"}},
    )
    conflict_service.resolve_conflict(
        db, conflict, owner, action="keep_both", fields={"first_name": "b"}
    )
    db.refresh(keep)
    assert keep.first_name == "Anna"


# --- routes ------------------------------------------------------------------


def test_reports_route_lists_only_my_reports(client, db, owner):
    run = _make_run(db)
    other = make_user(db, "mallory")
    report_service.create_report(
        db,
        run_id=run.id,
        owner_user_id=owner.id,
        workspace_mappings=[],
        grant_changes=[],
        converted_virtual_views=[],
        dropped_virtual_views=[],
        media_verification={},
        validation_summary={},
    )
    report_service.create_report(
        db,
        run_id=run.id,
        owner_user_id=other.id,
        workspace_mappings=[],
        grant_changes=[],
        converted_virtual_views=[],
        dropped_virtual_views=[],
        media_verification={},
        validation_summary={},
    )
    resp = client.get(f"{API}/migration/reports", headers=auth(owner))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["reports"]) == 1
    assert body["reports"][0]["owner_user_id"] == owner.id


def test_report_route_404s_for_another_owner(client, db, owner):
    run = _make_run(db)
    other = make_user(db, "mallory")
    report = report_service.create_report(
        db,
        run_id=run.id,
        owner_user_id=owner.id,
        workspace_mappings=[],
        grant_changes=[],
        converted_virtual_views=[],
        dropped_virtual_views=[],
        media_verification={},
        validation_summary={},
    )
    resp = client.get(f"{API}/migration/reports/{report.id}", headers=auth(other))
    assert resp.status_code == 403


def test_conflict_resolve_route(client, db, owner):
    run = _make_run(db)
    conflict = _make_conflict(db, run, owner)
    resp = client.post(
        f"{API}/migration/conflicts/{conflict.id}/resolve",
        json={"action": "keep_both", "fields": {}},
        headers=auth(owner),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "resolved"


def test_admin_run_routes_require_admin(client, db, owner):
    run = _make_run(db)
    resp = client.get(f"{API}/admin/migration/runs/{run.id}", headers=auth(owner))
    assert resp.status_code == 403


def test_admin_finalize_route(client, db):
    admin = make_user(db, "root", is_admin=True)
    run = _make_run(db, status=MigrationStatus.COMPLETE)
    resp = client.post(
        f"{API}/admin/migration/runs/{run.id}/finalize", headers=auth(admin)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "finalized"
    assert resp.json()["finalized_by"] == admin.id
