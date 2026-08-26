import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberSheetState } from "@/utils/memberSheetState";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { migrateV1BrowserState, remapOpenSheets } from "./migrateBrowserState";

vi.mock("@/services/WorkspaceService");

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
    vi.mocked(WorkspaceService.resolveLegacyWorkspaceId).mockReset();
  });

  afterEach(() => {
    localStorage.removeItem(FLAG_KEY);
    useMemberSheetStore.setState({ openSheets: {} });
  });

  it("remaps each open sheet's id individually and sets the one-time flag", async () => {
    useMemberSheetStore.setState({ openSheets: { "old-tree": SHEET } });
    vi.mocked(WorkspaceService.resolveLegacyWorkspaceId).mockResolvedValue(
      "new-tree",
    );

    await migrateV1BrowserState();

    expect(WorkspaceService.resolveLegacyWorkspaceId).toHaveBeenCalledWith(
      "old-tree",
    );
    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "new-tree": SHEET,
    });
    expect(localStorage.getItem(FLAG_KEY)).toBe("1");
  });

  it("resolves a sheet on a workspace merely shared with (not owned by) this user", async () => {
    // Regression: this must not depend on the current user's own migration
    // reports, which are scoped to workspaces *they* own.
    useMemberSheetStore.setState({ openSheets: { "shared-old-tree": SHEET } });
    vi.mocked(WorkspaceService.resolveLegacyWorkspaceId).mockResolvedValue(
      "shared-new-tree",
    );

    await migrateV1BrowserState();

    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "shared-new-tree": SHEET,
    });
  });

  it("never resolves a vv_ (virtual view) entry — it's dropped outright", async () => {
    useMemberSheetStore.setState({ openSheets: { vv_stale: SHEET } });

    await migrateV1BrowserState();

    expect(WorkspaceService.resolveLegacyWorkspaceId).not.toHaveBeenCalled();
    expect(useMemberSheetStore.getState().openSheets).toEqual({});
    expect(localStorage.getItem(FLAG_KEY)).toBe("1");
  });

  it("is a no-op on a later call once the flag is set", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    useMemberSheetStore.setState({ openSheets: { "old-tree": SHEET } });

    await migrateV1BrowserState();

    expect(WorkspaceService.resolveLegacyWorkspaceId).not.toHaveBeenCalled();
    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "old-tree": SHEET,
    });
  });

  it("leaves state and the flag untouched when resolution fails unexpectedly", async () => {
    useMemberSheetStore.setState({ openSheets: { "old-tree": SHEET } });
    vi.mocked(WorkspaceService.resolveLegacyWorkspaceId).mockImplementation(
      () => {
        throw new Error("unexpected");
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await migrateV1BrowserState();

    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "old-tree": SHEET,
    });
  });
});
