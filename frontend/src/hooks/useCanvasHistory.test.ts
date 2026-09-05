import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCanvasHistory } from "./useCanvasHistory";
import { useMemberStore } from "./useMemberStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const TREE_ID = "tree-abc";

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    selectedTree: { id: TREE_ID, name: "Test Workspace", role: "owner" } as Workspace,
  });
  useMemberStore.setState({
    windowed: true,
    windowedForTreeId: TREE_ID,
    focusRootId: "m1",
    focusSectionIds: null,
    neighborhoodUp: 3,
    neighborhoodDown: 3,
    members: [],
    neighborhoodMemberRows: [],
    neighborhoodRelations: [],
    neighborhoodCursor: null,
    continuations: [],
  });
  // Echo back the requested root, like the real endpoint does, so a
  // popstate-triggered refetch doesn't itself change `focusRootId` again
  // once the request resolves.
  vi.mocked(WorkspaceService.getNeighborhood).mockImplementation(
    async (_workspaceId, root) => ({
      members: [],
      relations: [],
      root_id: root ?? "m1",
      truncated: false,
      total_member_count: 0,
    }),
  );
  window.history.replaceState(null, "");
});

afterEach(() => {
  // Each test mounts its own hook instance whose effects push/replace
  // `window.history` state; unmount it before the next test's beforeEach
  // resets store state, or a still-subscribed instance from a previous test
  // would react to that reset as a real focus change.
  cleanup();
  // vi.clearAllMocks() (in beforeEach) only clears call history — a
  // vi.spyOn on window.history.pushState/replaceState stays installed
  // otherwise, so a later test's setup calls (before it creates its own
  // "local" spy variable) would still be recorded by the earlier spy.
  vi.restoreAllMocks();
});

describe("useCanvasHistory", () => {
  it("pushes a history entry when the focus changes, but not on the initial render", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    renderHook(() => useCanvasHistory(TREE_ID, null));
    expect(pushSpy).not.toHaveBeenCalled();

    act(() => {
      useMemberStore.setState({ focusRootId: "m2" });
    });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [state] = pushSpy.mock.calls[0];
    expect(state).toMatchObject({
      __ftCanvas: true,
      workspaceId: TREE_ID,
      focusRootId: "m2",
    });
  });

  it("does not push again right after restoring a popped entry", async () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    renderHook(() => useCanvasHistory(TREE_ID, { setViewport: vi.fn() }));

    await act(async () => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: {
            __ftCanvas: true,
            workspaceId: TREE_ID,
            focusRootId: "m9",
            focusSectionIds: null,
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        }),
      );
    });

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("restores focus on popstate by refetching, and applies the saved camera", async () => {
    const setViewport = vi.fn();
    renderHook(() => useCanvasHistory(TREE_ID, { setViewport }));

    await act(async () => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: {
            __ftCanvas: true,
            workspaceId: TREE_ID,
            focusRootId: "m9",
            focusSectionIds: null,
            viewport: { x: 1, y: 2, zoom: 3 },
          },
        }),
      );
    });

    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      "m9",
      expect.any(Number),
      expect.any(Number),
      true,
      undefined,
    );
    expect(setViewport).toHaveBeenCalledWith(
      { x: 1, y: 2, zoom: 3 },
      { duration: 0 },
    );
  });

  it("ignores a popstate event carrying a different workspace's state", async () => {
    const setViewport = vi.fn();
    renderHook(() => useCanvasHistory(TREE_ID, { setViewport }));

    await act(async () => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: {
            __ftCanvas: true,
            workspaceId: "other-tree",
            focusRootId: "m9",
            focusSectionIds: null,
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        }),
      );
    });

    expect(WorkspaceService.getNeighborhood).not.toHaveBeenCalled();
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("updateHistoryViewport replaces the current entry instead of pushing a new one", () => {
    window.history.pushState(
      {
        __ftCanvas: true,
        workspaceId: TREE_ID,
        focusRootId: "m1",
        focusSectionIds: null,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      "",
    );
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useCanvasHistory(TREE_ID, null));

    act(() => {
      result.current.updateHistoryViewport({ x: 5, y: 6, zoom: 2 });
    });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { x: 5, y: 6, zoom: 2 } }),
      "",
    );
  });
});
