/**
 * Types for the post-migration report and review checklist (#991).
 * These mirror the backend Pydantic schemas in app/schemas/migration.py.
 */

import { MergeFieldChoice } from "./merge";

export type MigrationReportStatus = "pending" | "acknowledged";
export type MigrationConflictStatus = "pending" | "resolved" | "dismissed";
export type MigrationConflictKind = "bridge_merge" | "virtual_view_match";
export type MigrationConflictAction = "merge" | "keep_both" | "dismiss";

export interface MigrationReportDB {
  id: string;
  run_id: string;
  owner_user_id: string;
  workspace_mappings: Record<string, unknown>[];
  grant_changes: Record<string, unknown>[];
  converted_virtual_views: Record<string, unknown>[];
  dropped_virtual_views: Record<string, unknown>[];
  media_verification: Record<string, unknown>;
  validation_summary: Record<string, unknown>;
  status: MigrationReportStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MigrationConflictDB {
  id: string;
  run_id: string;
  kind: MigrationConflictKind;
  workspace_id: string;
  source_section_id: string | null;
  member_a_id: string;
  member_b_id: string;
  canonical_member_id: string | null;
  conflicting_fields: string[];
  field_values: Record<string, Record<string, unknown>>;
  conflicting_media: Record<string, unknown>[];
  blocks_finalization: boolean;
  status: MigrationConflictStatus;
  resolution: {
    action: MigrationConflictAction;
    fields: Record<string, string>;
  } | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface MigrationConflictResolveRequest {
  action: MigrationConflictAction;
  fields: Partial<Record<string, MergeFieldChoice>>;
}

export interface GrantAccessSummary {
  scope: "section" | "workspace";
  section_id: string | null;
  role: string;
  restrictions: string[];
}

export interface GrantWidenResult {
  before: GrantAccessSummary;
  after: GrantAccessSummary;
}
