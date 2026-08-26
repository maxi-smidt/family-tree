"""Schemas for the durable migration state APIs (#997).

Owner-facing schemas never include ``MigrationRun`` internals (backup id/path,
raw failure detail, checkpoint) — those stay on the admin-only run endpoints.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.merge import FieldChoice


class MigrationRunOut(BaseModel):
    id: str
    source_version: str
    target_version: str
    status: str
    phase: str
    backup_id: str | None
    backup_path: str | None
    started_at: str
    updated_at: str
    heartbeat_at: str | None
    completed_at: str | None
    finalized_at: str | None
    finalized_by: str | None
    failure_code: str | None
    failure_detail: str | None
    checkpoint: dict | None


class MigrationReportOut(BaseModel):
    id: str
    run_id: str
    owner_user_id: str
    workspace_mappings: list[dict]
    grant_changes: list[dict]
    converted_virtual_views: list[dict]
    dropped_virtual_views: list[dict]
    media_verification: dict
    validation_summary: dict
    status: str
    acknowledged_by: str | None
    acknowledged_at: str | None
    created_at: str
    updated_at: str


class MigrationReportListOut(BaseModel):
    reports: list[MigrationReportOut]


class MigrationConflictOut(BaseModel):
    id: str
    run_id: str
    kind: str
    workspace_id: str
    source_section_id: str | None
    member_a_id: str
    member_b_id: str
    conflicting_fields: list[str]
    conflicting_media: list[dict]
    status: str
    resolution: dict | None
    resolved_by: str | None
    resolved_at: str | None
    created_at: str


class MigrationConflictListOut(BaseModel):
    conflicts: list[MigrationConflictOut]


class MigrationConflictResolveRequest(BaseModel):
    action: Literal["merge", "keep_both", "dismiss"]
    fields: dict[str, FieldChoice] = Field(default_factory=dict)
