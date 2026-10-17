import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMigrationReviewStore } from "@/hooks/useMigrationReviewStore";
import { MigrationReportDB } from "@/types/migration";
import { MigrationReviewView } from "./MigrationReviewView";

function report(status: MigrationReportDB["status"]): MigrationReportDB {
  return {
    id: "r1",
    run_id: "run1",
    owner_user_id: "u1",
    workspace_mappings: [{ source_workspace_name: "Smidt", is_survivor: true }],
    grant_changes: [],
    converted_virtual_views: [],
    dropped_virtual_views: [],
    media_verification: {},
    validation_summary: {},
    status,
    acknowledged_by: null,
    acknowledged_at: null,
    created_at: "2026-10-17T10:00:00Z",
    updated_at: "2026-10-17T10:00:00Z",
  };
}

function seed(status: MigrationReportDB["status"]) {
  // `loaded` + a no-op `load` keep the view from refetching on mount.
  useMigrationReviewStore.setState({
    reports: [report(status)],
    conflicts: [],
    loaded: true,
    loading: false,
    load: async () => {},
  });
}

describe("MigrationReviewView", () => {
  beforeEach(() => {
    useMigrationReviewStore.setState({ reports: [], conflicts: [] });
  });

  it("counts only visited steps while the review is still open", () => {
    seed("pending");
    render(<MigrationReviewView />);
    // Workspaces (opened by default) and an empty differences list.
    expect(screen.getByText("2 of 5 steps reviewed")).toBeInTheDocument();
  });

  it("marks every step done once the report is acknowledged, even unvisited empty ones", () => {
    seed("acknowledged");
    render(<MigrationReviewView />);
    expect(screen.getByText("5 of 5 steps reviewed")).toBeInTheDocument();
  });
});
