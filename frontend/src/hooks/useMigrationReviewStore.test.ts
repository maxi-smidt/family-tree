import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useMigrationReviewStore,
  usePendingMigrationReviewCount,
} from "./useMigrationReviewStore";
import { MigrationService } from "@/services/MigrationService";
import { MigrationConflictDB, MigrationReportDB } from "@/types/migration";

vi.mock("@/services/MigrationService");

function report(overrides: Partial<MigrationReportDB> = {}): MigrationReportDB {
  return {
    id: "report-1",
    run_id: "run-1",
    owner_user_id: "owner-1",
    workspace_mappings: [],
    grant_changes: [],
    converted_virtual_views: [],
    dropped_virtual_views: [],
    media_verification: {},
    validation_summary: {},
    status: "pending",
    acknowledged_by: null,
    acknowledged_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function conflict(
  overrides: Partial<MigrationConflictDB> = {},
): MigrationConflictDB {
  return {
    id: "conflict-1",
    run_id: "run-1",
    kind: "bridge_merge",
    workspace_id: "ws-1",
    source_section_id: null,
    member_a_id: "m1",
    member_b_id: "m2",
    canonical_member_id: "m1",
    conflicting_fields: ["first_name"],
    field_values: { first_name: { m1: "Anna", m2: "Annie" } },
    conflicting_media: [],
    blocks_finalization: false,
    status: "pending",
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMigrationReviewStore.setState({
    reports: [],
    conflicts: [],
    loading: false,
    loaded: false,
  });
});

describe("useMigrationReviewStore", () => {
  it("load populates reports and conflicts", async () => {
    vi.mocked(MigrationService.listReports).mockResolvedValue([report()]);
    vi.mocked(MigrationService.listConflicts).mockResolvedValue([conflict()]);

    await useMigrationReviewStore.getState().load();

    const state = useMigrationReviewStore.getState();
    expect(state.reports).toHaveLength(1);
    expect(state.conflicts).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
  });

  it("acknowledgeReport replaces the updated report in place", async () => {
    useMigrationReviewStore.setState({ reports: [report()], loaded: true });
    vi.mocked(MigrationService.acknowledgeReport).mockResolvedValue(
      report({ status: "acknowledged", acknowledged_by: "owner-1" }),
    );

    await useMigrationReviewStore.getState().acknowledgeReport("report-1");

    expect(useMigrationReviewStore.getState().reports[0].status).toBe(
      "acknowledged",
    );
  });

  it("resolveConflict replaces the updated conflict in place", async () => {
    useMigrationReviewStore.setState({
      conflicts: [conflict()],
      loaded: true,
    });
    vi.mocked(MigrationService.resolveConflict).mockResolvedValue(
      conflict({ status: "resolved" }),
    );

    await useMigrationReviewStore
      .getState()
      .resolveConflict("conflict-1", { action: "keep_both", fields: {} });

    expect(useMigrationReviewStore.getState().conflicts[0].status).toBe(
      "resolved",
    );
  });

  it("widenGrant reloads after applying the change", async () => {
    vi.mocked(MigrationService.widenGrant).mockResolvedValue({
      before: {
        scope: "section",
        section_id: "s1",
        role: "editor",
        restrictions: [],
      },
      after: {
        scope: "workspace",
        section_id: null,
        role: "editor",
        restrictions: [],
      },
    });
    vi.mocked(MigrationService.listReports).mockResolvedValue([]);
    vi.mocked(MigrationService.listConflicts).mockResolvedValue([]);

    const result = await useMigrationReviewStore
      .getState()
      .widenGrant("report-1", "s1", "user-1");

    expect(result.after.scope).toBe("workspace");
    expect(MigrationService.listReports).toHaveBeenCalledTimes(1);
  });

  it("usePendingMigrationReviewCount counts unacknowledged reports and pending conflicts", () => {
    useMigrationReviewStore.setState({
      reports: [
        report({ status: "pending" }),
        report({ id: "r2", status: "acknowledged" }),
      ],
      conflicts: [
        conflict({ status: "pending" }),
        conflict({ id: "c2", status: "resolved" }),
      ],
    });

    const { result } = renderHook(() => usePendingMigrationReviewCount());
    expect(result.current).toBe(2);
  });
});
