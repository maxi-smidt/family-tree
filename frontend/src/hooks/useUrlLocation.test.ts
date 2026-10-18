import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import {
  captureInitialLocation,
  resetUrlLocationForTests,
  useUrlLocation,
} from "./useUrlLocation";
import { useActiveViewStore } from "./useActiveViewStore";
import { useMemberSheetStore } from "./useMemberSheetStore";
import { useMemberStore } from "./useMemberStore";
import { useSectionStore } from "./useSectionStore";
import { useWorkspaceNavStore } from "./useWorkspaceNavStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { MemberDB } from "@/types/member";
import { SectionDB } from "@/types/section";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const TREE_ID = "tree-abc";

function memberRow(id: string): MemberDB {
  return {
    id,
    gender: "m",
    academicTitle: null,
    firstName: id,
    lastName: "Doe",
    middleNames: null,
    baptismalName: null,
    maidenName: null,
    imageData: null,
    dateOfBirth: null,
    dateOfDeath: null,
    deceased: false,
    adopted: false,
    isCollapsed: 0,
    positionX: 0,
    positionY: 0,
  };
}

function popTo(url: string, state: unknown = { __ftLocation: true }) {
  window.history.replaceState(state, "", url);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUrlLocationForTests();
  window.history.replaceState(null, "", "/");
  useWorkspaceStore.setState({
    selectedTree: { id: TREE_ID, name: "Weber", role: "owner" } as Workspace,
    workspaces: [{ id: TREE_ID, name: "Weber", role: "owner" } as Workspace],
    isReady: true,
  });
  useActiveViewStore.setState({
    activeView: "tree-view",
    mediaSection: "gallery",
  });
  useMemberSheetStore.setState({ openSheets: {} });
  useSectionStore.setState({ sections: [], initialized: false });
  useWorkspaceNavStore.getState().clear();
  useMemberStore.setState({
    windowed: true,
    windowedForTreeId: TREE_ID,
    focusRootId: "m1",
    focusSectionIds: null,
    focusPending: false,
    activeSavedViewId: null,
    savedViewPositions: [],
    savedViewFilters: {},
    neighborhoodUp: 3,
    neighborhoodDown: 3,
    members: [],
    neighborhoodMemberRows: [],
    neighborhoodRelations: [],
    neighborhoodCursor: null,
    continuations: [],
  });
  vi.mocked(WorkspaceService.getMembers).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
  // Echo back the requested root with that member in it, like the real
  // endpoint does for a member the viewer can reach.
  vi.mocked(WorkspaceService.getNeighborhood).mockImplementation(
    async (_workspaceId, root) => ({
      members: [memberRow(root ?? "m1")],
      relations: [],
      root_id: root ?? "m1",
      truncated: false,
      total_member_count: 1,
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useUrlLocation", () => {
  it("writes the canonical URL on mount without adding an entry", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");

    renderHook(() => useUrlLocation());

    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe(
      "/w/tree-abc/tree?focus=m1",
    );
    expect(window.history.state).toMatchObject({ __ftLocation: true });
  });

  it("adds an entry per real step and replaces for a sheet tab switch", () => {
    renderHook(() => useUrlLocation());
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    act(() => useMemberStore.setState({ focusRootId: "m2" }));
    act(() =>
      useMemberSheetStore.getState().setOpenSheet(TREE_ID, {
        memberId: "m2",
        tab: "identity",
        mode: "view",
      }),
    );
    expect(pushSpy).toHaveBeenCalledTimes(2);

    act(() =>
      useMemberSheetStore.getState().setOpenSheet(TREE_ID, {
        memberId: "m2",
        tab: "life",
        mode: "view",
      }),
    );
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?focus=m2&member=m2&tab=life");

    act(() => useActiveViewStore.getState().setActiveView("list-view"));
    expect(pushSpy).toHaveBeenCalledTimes(3);
    expect(window.location.pathname).toBe("/w/tree-abc/list");
    expect(window.location.search).toBe("");
  });

  it("adds exactly one entry for a section whose root resolves asynchronously", async () => {
    renderHook(() => useUrlLocation());
    const pushSpy = vi.spyOn(window.history, "pushState");

    // focusSection briefly sets focusRootId to null while the section's
    // default root resolves; that transitional value is not a step.
    await act(async () => {
      await useMemberStore.getState().focusSection("sec-1");
    });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?section=sec-1");
  });

  it("applies the URL the page was opened with once the workspace is ready", async () => {
    window.history.replaceState(
      null,
      "",
      "/w/tree-abc/tree?focus=m7&member=m7&tab=records",
    );
    captureInitialLocation();

    renderHook(() => useUrlLocation());

    await waitFor(() =>
      expect(useMemberSheetStore.getState().openSheets[TREE_ID]).toEqual({
        memberId: "m7",
        tab: "records",
        mode: "view",
      }),
    );
    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      "m7",
      expect.any(Number),
      expect.any(Number),
      true,
      undefined,
    );
    await waitFor(() =>
      expect(window.location.search).toBe("?focus=m7&member=m7&tab=records"),
    );
  });

  it("restores focus and the open member on back/forward without adding entries", async () => {
    renderHook(() => useUrlLocation());
    const pushSpy = vi.spyOn(window.history, "pushState");

    await act(async () => {
      popTo("/w/tree-abc/tree?focus=m9&member=m9");
    });

    await waitFor(() =>
      expect(useMemberStore.getState().focusRootId).toBe("m9"),
    );
    expect(useMemberSheetStore.getState().openSheets[TREE_ID]?.memberId).toBe(
      "m9",
    );
    expect(pushSpy).not.toHaveBeenCalled();

    await act(async () => {
      popTo("/w/tree-abc/tree?focus=m9");
    });
    expect(useMemberSheetStore.getState().openSheets[TREE_ID]).toBeUndefined();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("opens a section only when it is one the viewer can see", async () => {
    vi.mocked(WorkspaceService.getSections).mockResolvedValue([
      { id: "sec-ok" } as SectionDB,
    ]);
    renderHook(() => useUrlLocation());

    await act(async () => {
      popTo("/w/tree-abc/tree?section=sec-ok");
    });
    await waitFor(() =>
      expect(useMemberStore.getState().focusSectionIds).toEqual(["sec-ok"]),
    );
    expect(useWorkspaceNavStore.getState().selectedSectionId).toBe("sec-ok");

    await act(async () => {
      popTo("/w/tree-abc/tree?section=sec-hidden");
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(useMemberStore.getState().focusSectionIds).toBeNull();
    expect(useWorkspaceNavStore.getState().mode).toBe("explore");
    expect(window.location.search).not.toContain("sec-hidden");
  });

  it("falls back to the whole family when a linked saved view can't be opened", async () => {
    vi.mocked(WorkspaceService.getSavedView).mockRejectedValue(
      new Error("404"),
    );
    renderHook(() => useUrlLocation());
    const pushSpy = vi.spyOn(window.history, "pushState");

    await act(async () => {
      popTo("/w/tree-abc/tree?view=gone");
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(useWorkspaceNavStore.getState().mode).toBe("explore");
    expect(window.location.search).not.toContain("view=gone");
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("switches workspace when back/forward lands on another one", async () => {
    const other = { id: "tree-other", name: "Novák", role: "viewer" };
    useWorkspaceStore.setState((s) => ({
      workspaces: [...s.workspaces, other as Workspace],
    }));
    const selectTree = vi.fn(async (tree: Workspace | undefined) => {
      useWorkspaceStore.setState({ selectedTree: tree, isReady: true });
    });
    useWorkspaceStore.setState({ selectTree });
    renderHook(() => useUrlLocation());

    await act(async () => {
      popTo("/w/tree-other/timeline");
    });

    expect(selectTree).toHaveBeenCalledWith(other);
    expect(useActiveViewStore.getState().activeView).toBe("timeline-view");
    expect(window.location.pathname).toBe("/w/tree-other/timeline");
  });
});
