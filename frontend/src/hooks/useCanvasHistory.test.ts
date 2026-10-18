import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useCanvasHistory } from "./useCanvasHistory";
import {
  resetUrlLocationForTests,
  useLocationRestoreStore,
} from "./useUrlLocation";

const TREE_ID = "tree-abc";

beforeEach(() => {
  resetUrlLocationForTests();
  window.history.replaceState({ __ftLocation: true }, "", "/w/tree-abc/tree");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useCanvasHistory", () => {
  it("updateHistoryViewport keeps the camera on the current entry and URL", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useCanvasHistory(TREE_ID, null));

    act(() => {
      result.current.updateHistoryViewport({ x: 5, y: 6, zoom: 2 });
    });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({
      __ftLocation: true,
      viewport: { x: 5, y: 6, zoom: 2 },
    });
    expect(window.location.pathname).toBe("/w/tree-abc/tree");
  });

  it("re-applies the entry's saved camera once a restore finishes", async () => {
    window.history.replaceState(
      { __ftLocation: true, viewport: { x: 1, y: 2, zoom: 3 } },
      "",
    );
    const setViewport = vi.fn();
    const { result } = renderHook(() =>
      useCanvasHistory(TREE_ID, { setViewport }),
    );

    act(() => useLocationRestoreStore.setState({ restoring: true }));
    expect(result.current.restoringRef.current).toBe(true);

    act(() =>
      useLocationRestoreStore.setState({ restoring: false, restoredSeq: 1 }),
    );
    await waitFor(() =>
      expect(setViewport).toHaveBeenCalledWith(
        { x: 1, y: 2, zoom: 3 },
        { duration: 0 },
      ),
    );
    expect(result.current.restoringRef.current).toBe(false);
  });

  it("leaves the camera to the canvas when the entry has none saved", () => {
    const setViewport = vi.fn();
    const { result } = renderHook(() =>
      useCanvasHistory(TREE_ID, { setViewport }),
    );

    act(() => useLocationRestoreStore.setState({ restoring: true }));

    expect(result.current.restoringRef.current).toBe(false);
  });
});
