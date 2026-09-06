"""Durable v2 migration state (#997): run progress, per-owner reports, and
pending review conflicts.

The consolidation engine (#987), its preflight/backup step (#994), and media
relocation (#995) write through this module instead of encoding state only
in logs or a notification, so a crash/retry can resume the same run without
duplicating a report, conflict, section, or identity link. Conflict
resolution uses the same field-choice shape as the existing merge assistant
(``app.schemas.merge.MergeResolution``); a "merge" resolution is applied to
the surviving ``Member`` row via ``app.services.migration.conflicts`` (#1018),
reading the values captured on the conflict itself since the other row was
already deleted by the bridge collapse that created it.

Retention: every table here is included in v2 instance backups (see
``backup_service.BACKUP_MODELS``) and nothing in this module ever deletes a
row. Finalizing a run (``MigrationRun.status == "finalized"``) is only the
durable *signal* that legacy-artifact pruning may run — it does not itself
remove any report or conflict, so the audit trail survives finalization.
"""

from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class MigrationPhase(StrEnum):
    PREFLIGHT = "preflight"
    BACKUP = "backup"
    CONVERTING = "converting"
    MEDIA = "media"
    VALIDATING = "validating"


# Forward-only order enforced by app.services.migration.state_machine.
MIGRATION_PHASE_ORDER: tuple[MigrationPhase, ...] = (
    MigrationPhase.PREFLIGHT,
    MigrationPhase.BACKUP,
    MigrationPhase.CONVERTING,
    MigrationPhase.MEDIA,
    MigrationPhase.VALIDATING,
)


class MigrationStatus(StrEnum):
    RUNNING = "running"
    # Every phase finished and automated validation passed. Owner review
    # (MigrationReport/MigrationConflict) is non-blocking from here.
    COMPLETE = "complete"
    # A phase failed but the checkpoint is safe to resume from.
    RECOVERABLE = "recoverable"
    # A phase failed and cannot be resumed from its checkpoint.
    FAILED = "failed"
    # Operator confirmed the run; unlocks #1019 legacy-artifact pruning.
    FINALIZED = "finalized"


class MigrationRun(Base):
    __tablename__ = "migration_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    # Holds the current Alembic head id(s) when no prior run exists (see
    # app.services.migration.orchestrator._source_version) — not a short
    # semver like target_version, hence the wider column (#998).
    source_version: Mapped[str] = mapped_column(String(255))
    target_version: Mapped[str] = mapped_column(String(20))

    status: Mapped[str] = mapped_column(String(20), default=MigrationStatus.RUNNING)
    phase: Mapped[str] = mapped_column(String(20), default=MigrationPhase.PREFLIGHT)
    # Phase-private resume state (e.g. last processed workspace id); opaque
    # to everything except the phase that wrote it.
    checkpoint: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Not an FK: BackupRecord is deliberately excluded from the restorable
    # archive (see backup_service.BACKUP_EXCLUDED_MODELS), so a restored
    # instance's migration_runs rows would otherwise dangle-reference a
    # backup_records row that was never brought back.
    backup_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    backup_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    started_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    # Bumped on every transition so a monitor can tell a stalled run from one
    # still making progress; not itself a state transition.
    heartbeat_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    finalized_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    finalized_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Short, stable code safe to surface outside the admin API (e.g.
    # "media_verification_failed"); the free-form trace stays operator-only.
    failure_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    failure_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Every transition goes through app.services.migration.state_machine,
    # which row-locks the run and relies on this for the optimistic check.
    version: Mapped[int] = mapped_column(Integer, default=0)

    __mapper_args__ = {"version_id_col": version}


class MigrationMapping(Base):
    """The deterministic old-workspace -> surviving-workspace/section mapping
    and the survivor tie-break inputs, persisted so #987/#995 consume one
    versioned decision instead of re-deriving it."""

    __tablename__ = "migration_mappings"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "source_workspace_id", name="uq_migration_mapping_source"
        ),
        Index("ix_migration_mappings_run_id", "run_id"),
        Index("ix_migration_mappings_target_workspace_id", "target_workspace_id"),
        # The uq_migration_mapping_source unique index above is (run_id,
        # source_workspace_id) — useless for #1012's public legacy-id lookup,
        # which filters by source_workspace_id alone across every run.
        Index("ix_migration_mappings_source_workspace_id", "source_workspace_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("migration_runs.id", ondelete="CASCADE")
    )
    # The pre-consolidation workspace id. Not an FK: by the time a report is
    # read, a non-survivor source row may already be gone.
    source_workspace_id: Mapped[str] = mapped_column(String(36))
    source_workspace_name: Mapped[str] = mapped_column(String(255))
    target_workspace_id: Mapped[str] = mapped_column(String(36))
    # Null when source_workspace_id *is* the survivor.
    target_section_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_survivor: Mapped[bool] = mapped_column(Boolean, default=False)
    # Inputs the survivor tie-break used for this cluster (member/content
    # counts, owner, created_at, ...) — kept for audit, not re-derived.
    tie_break_inputs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)


class MigrationReportStatus(StrEnum):
    PENDING = "pending"
    ACKNOWLEDGED = "acknowledged"


class MigrationReport(Base):
    """One per-owner summary of what conversion did to their workspaces —
    the durable copy of migration state a notification only points to."""

    __tablename__ = "migration_reports"
    __table_args__ = (
        UniqueConstraint("run_id", "owner_user_id", name="uq_migration_report_owner"),
        Index("ix_migration_reports_owner_user_id", "owner_user_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("migration_runs.id", ondelete="CASCADE")
    )
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )

    # Each a JSON list/dict of plain values; app.schemas.migration shapes
    # these for owner-facing responses.
    workspace_mappings: Mapped[list] = mapped_column(JSON, default=list)
    grant_changes: Mapped[list] = mapped_column(JSON, default=list)
    converted_virtual_views: Mapped[list] = mapped_column(JSON, default=list)
    dropped_virtual_views: Mapped[list] = mapped_column(JSON, default=list)
    media_verification: Mapped[dict] = mapped_column(JSON, default=dict)
    validation_summary: Mapped[dict] = mapped_column(JSON, default=dict)

    status: Mapped[str] = mapped_column(
        String(20), default=MigrationReportStatus.PENDING
    )
    acknowledged_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acknowledged_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)


class MigrationConflictKind(StrEnum):
    BRIDGE_MERGE = "bridge_merge"
    VIRTUAL_VIEW_MATCH = "virtual_view_match"


class MigrationConflictStatus(StrEnum):
    PENDING = "pending"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class MigrationConflict(Base):
    """A pending bridge-merge conflict or virtual-view match suggestion
    surfaced for owner review."""

    __tablename__ = "migration_conflicts"
    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "kind",
            "member_a_id",
            "member_b_id",
            name="uq_migration_conflict_pair",
        ),
        Index("ix_migration_conflicts_owner_user_id", "owner_user_id"),
        Index("ix_migration_conflicts_workspace_id", "workspace_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("migration_runs.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(30))
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    workspace_id: Mapped[str] = mapped_column(String(36))
    source_section_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    member_a_id: Mapped[str] = mapped_column(String(36))
    member_b_id: Mapped[str] = mapped_column(String(36))
    # Whichever of member_a_id/member_b_id survived the bridge collapse that
    # created this conflict — the row a "merge" resolution applies to. Null
    # for a kind that never collapsed a pair (virtual_view_match) or a row
    # predating this column.
    canonical_member_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    conflicting_fields: Mapped[list] = mapped_column(JSON, default=list)
    conflicting_media: Mapped[list] = mapped_column(JSON, default=list)
    # Per drifted field, the two rows' values keyed by member id (so they line
    # up with a resolution's "a"/"b" choice regardless of which id survived):
    # {field: {member_a_id: value, member_b_id: value}}. Captured before the
    # non-canonical row was deleted — it is the only remaining source for the
    # value a "merge" resolution would apply. Empty for a conflict kind that
    # doesn't drift scalar fields (virtual_view_match) or one predating this
    # column.
    field_values: Mapped[dict] = mapped_column(JSON, default=dict)

    # A required data postcondition, not just a UX nicety: finalize refuses
    # while any pending conflict has this set. False for ordinary review
    # items — human review is otherwise non-blocking after validation passes.
    blocks_finalization: Mapped[bool] = mapped_column(Boolean, default=False)

    status: Mapped[str] = mapped_column(
        String(20), default=MigrationConflictStatus.PENDING
    )
    # MergeResolution-shaped: {"action": "merge"|"keep_both", "fields": {...}}
    # for a bridge_merge, or {"action": "dismiss"} either way. Null until
    # resolved/dismissed.
    resolution: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)

    # Optimistic concurrency so resolution is exactly-once.
    version: Mapped[int] = mapped_column(Integer, default=0)

    __mapper_args__ = {"version_id_col": version}


class MigrationIdempotencyKey(Base):
    """Dedupes a retried phase-execution side effect (report / notification /
    section / identity-link / conflict creation) so replaying a phase after a
    crash cannot duplicate it. ``target_type``/``target_id`` name whichever
    row the first attempt produced; a replay looks itself up by
    ``(run_id, phase, key)`` and returns that row instead of re-creating it."""

    __tablename__ = "migration_idempotency_keys"

    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("migration_runs.id", ondelete="CASCADE"), primary_key=True
    )
    phase: Mapped[str] = mapped_column(String(20), primary_key=True)
    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    target_type: Mapped[str] = mapped_column(String(30))
    # Wide enough for a prefixed id like SavedView's ("sv_" + uuid, 39 chars),
    # not just a bare uuid (#992 — this truncated on every real Postgres
    # virtual-view conversion; SQLite silently ignores VARCHAR length, which
    # is why it went unnoticed until real-Postgres migration coverage).
    target_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
