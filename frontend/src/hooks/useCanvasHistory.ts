import { useEffect, useRef } from "react";
import {
  isLocationHistoryState,
  useLocationRestoreStore,
} from "@/hooks/useUrlLocation";

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Camera position per history entry for the tree canvas. The URL itself —
 * workspace, page, saved view / section / focus person, open member — is
 * written and restored by `useUrlLocation` (#1128); this hook only keeps the
 * current entry's camera up to date while panning and re-applies it after
 * Back/forward, so the user lands where they actually left off rather than
 * on a fresh fit. Only the camera goes into `history.state`; member data
 * never does, so a revoked node can't be resurrected from history.
 */
export function useCanvasHistory(
  workspaceId: string | undefined,
  rfInstance: {
    setViewport: (vp: Viewport, opts?: { duration?: number }) => void;
  } | null,
) {
  // True while Back/forward is restoring an entry that has a saved camera —
  // lets the canvas skip its own "re-fit on focus change" in favour of the
  // exact restored position.
  const restoringRef = useRef(false);
  const restoring = useLocationRestoreStore((s) => s.restoring);
  const restoredSeq = useLocationRestoreStore((s) => s.restoredSeq);

  useEffect(() => {
    if (!workspaceId || !restoring) return;
    const state = window.history.state as unknown;
    restoringRef.current =
      isLocationHistoryState(state) && state.viewport !== undefined;
  }, [restoring, workspaceId]);

  useEffect(() => {
    if (!restoringRef.current) return;
    const state = window.history.state as unknown;
    const frame = requestAnimationFrame(() => {
      if (isLocationHistoryState(state) && state.viewport) {
        rfInstance?.setViewport(state.viewport, { duration: 0 });
      }
      restoringRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
    // Runs once per finished restore, not when the canvas instance changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredSeq]);

  function updateHistoryViewport(viewport: Viewport) {
    if (!workspaceId) return;
    const state = window.history.state as unknown;
    if (!isLocationHistoryState(state)) return;
    window.history.replaceState({ ...state, viewport }, "");
  }

  return { restoringRef, updateHistoryViewport };
}
