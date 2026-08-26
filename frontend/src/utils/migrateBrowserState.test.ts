import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberSheetState } from "@/utils/memberSheetState";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { MigrationService } from "@/services/MigrationService";
import { migrateV1BrowserState, remapOpenSheets } from "./migrateBrowserState";

vi.mock("@/services/MigrationService");

const SHEET: MemberSheetState = {
  memberId: "member-1",
  tab: "identity",
  mode: "view",
};

describe("remapOpenSheets", () => {
  it("rewrites an entry keyed by a workspace id the migration mapped", () => {
    const result = remapOpenSheets(
      { "old-tree": SHEET },
      new Map([["old-tree", "new-tree"]]),
    );
    expect(result).toEqual({ "new-tree": SHEET });
  });

  it("drops a vv_ (virtual view) entry unconditionally", () => {
    const result = remapOpenSheets({ vv_stale: SHEET }, new Map());
    expect(result).toEqual({});
  });

  it("leaves an unmapped, non-virtual entry untouched", () => {
    const result = remapOpenSheets({ "current-tree": SHEET }, new Map());
    expect(result).toEqual({ "current-tree": SHEET });
  });
});

describe("migrateV1BrowserState", () => {
  const FLAG_KEY = "ft_v1_state_migrated";

  beforeEach(() => {
    localStorage.removeItem(FLAG_KEY);
    useMemberSheetStore.setState({ openSheets: {} });
    vi.mocked(MigrationService.listReports).mockReset();
  });

  afterEach(() => {
    localStorage.removeItem(FLAG_KEY);
    useMemberSheetStore.setState({ openSheets: {} });
  });

  it("remaps open sheets using every report's mappings and sets the one-time flag", async () => {
    useMemberSheetStore.setState({ openSheets: { "old-tree": SHEET } });
    vi.mocked(MigrationService.listReports).mockResolvedValue([
      {
        id: "report-1",
        workspace_mappings: [
          { source_workspace_id: "old-tree", target_workspace_id: "new-tree" },
        ],
      },
    ]);

    await migrateV1BrowserState();

    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "new-tree": SHEET,
    });
    expect(localStorage.getItem(FLAG_KEY)).toBe("1");
  });

  it("is a no-op on a later call once the flag is set", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    useMemberSheetStore.setState({ openSheets: { "old-tree": SHEET } });

    await migrateV1BrowserState();

    expect(MigrationService.listReports).not.toHaveBeenCalled();
    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "old-tree": SHEET,
    });
  });

  it("leaves state and the flag untouched when the reports fetch fails", async () => {
    useMemberSheetStore.setState({ openSheets: { "old-tree": SHEET } });
    vi.mocked(MigrationService.listReports).mockRejectedValue(
      new Error("network error"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await migrateV1BrowserState();

    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "old-tree": SHEET,
    });
  });
});
