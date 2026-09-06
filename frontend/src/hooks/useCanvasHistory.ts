import { useEffect, useRef } from "react";
import { useMemberStore } from "@/hooks/useMemberStore";

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface CanvasHistoryState {
  __ftCanvas: true;
  workspaceId: string;
  focusRootId: string | null;
  focusSectionIds: string[] | null;
  viewport: Viewport;
}

function isCanvasHistoryState(value: unknown): value is CanvasHistoryState {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { __ftCanvas?: unknown }).__ftCanvas === true
  );
}

/**
 * Browser back/forward for canvas focus (#989 hardening): pushes a history
 * entry whenever the committed focus root/section scope changes, and on
 * popstate re-derives the canvas from a fresh fetch rather than restoring
 * cached member data — a revoked or mutated node is never resurrected from
 * history state. Only the focus/section identity and the camera position are
 * stored; no member/relation data ever goes into `history.state`.
 */
export function useCanvasHistory(
  workspaceId: string | undefined,
  rfInstance: { setViewport: (vp: Viewport, opts?: { duration?: number }) => void } | null,
) {
  const focusRootId = useMemberStore((s) => s.focusRootId);
  const focusSectionIds = useMemberStore((s) => s.focusSectionIds);
  const focusPending = useMemberStore((s) => s.focusPending);
  const setFocusRoot = useMemberStore((s) => s.setFocusRoot);
  const focusSection = useMemberStore((s) => s.focusSection);
  const exitFocus = useMemberStore((s) => s.exitFocus);

  const mountedRef = useRef(false);
  const suppressNextPushRef = useRef(false);
  // True while a popstate-triggered refetch is in flight — lets the canvas
  // skip its own "re-fit on focus change" behaviour in favour of the exact
  // restored camera position.
  const restoringRef = useRef(false);

  useEffect(() => {
    if (!workspaceId) return;
    // A focus/scope change is still resolving (e.g. a section's default root
    // hasn't come back yet) — focusRootId/focusSectionIds are transitional,
    // not a settled state worth recording. Wait for it to commit; the effect
    // re-runs once `focusPending` flips back to false.
    if (focusPending) return;
    const state: CanvasHistoryState = {
      __ftCanvas: true,
      workspaceId,
      focusRootId,
      focusSectionIds,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    // Nothing to go "back" to on the very first render of a workspace — seed
    // the *current* entry instead of leaving it unmarked, so a subsequent
    // push (from the first real focus change) has a valid entry underneath
    // it for Back to land on and popstate to recognize.
    if (!mountedRef.current) {
      mountedRef.current = true;
      window.history.replaceState(state, "");
      return;
    }
    if (suppressNextPushRef.current) {
      suppressNextPushRef.current = false;
      return;
    }
    window.history.pushState(state, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, focusRootId, focusSectionIds, focusPending]);

  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      if (
        !workspaceId ||
        !isCanvasHistoryState(event.state) ||
        event.state.workspaceId !== workspaceId
      ) {
        return;
      }
      const target = event.state;
      suppressNextPushRef.current = true;
      restoringRef.current = true;
      const restore = target.focusSectionIds?.length
        ? focusSection(target.focusSectionIds[0])
        : target.focusRootId
          ? setFocusRoot(target.focusRootId)
          : exitFocus();
      void restore.finally(() => {
        rfInstance?.setViewport(target.viewport, { duration: 0 });
        restoringRef.current = false;
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [workspaceId, rfInstance, setFocusRoot, focusSection, exitFocus]);

  // Keep the most recent entry's stored camera current as the user pans, so
  // navigating back later restores where they actually left off rather than
  // wherever the viewport happened to be the instant focus changed.
  function updateHistoryViewport(viewport: Viewport) {
    const state = window.history.state as unknown;
    if (!isCanvasHistoryState(state) || state.workspaceId !== workspaceId) return;
    window.history.replaceState({ ...state, viewport }, "");
  }

  return { restoringRef, updateHistoryViewport };
}
