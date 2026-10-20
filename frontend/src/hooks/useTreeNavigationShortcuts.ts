import { useEffect } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { activeDialog, isTyping } from "@/lib/keyboardShortcuts";

type Navigation = Pick<
  ReactFlowInstance,
  "zoomIn" | "zoomOut" | "getViewport" | "setViewport"
>;

const directions: Record<string, { x: number; y: number }> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

export function useTreeNavigationShortcuts({
  zoomIn,
  zoomOut,
  getViewport,
  setViewport,
}: Navigation) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTyping(event.target) ||
        activeDialog()
      )
        return;
      const target = event.target;
      const direction = directions[event.key];
      if (direction) {
        // The listener lives only while the tree is mounted. Body focus is
        // common after closing a sheet; focus in the sidebar stays with it.
        if (
          target instanceof HTMLElement &&
          target !== document.body &&
          !target.closest(".ft-tree-canvas")
        )
          return;
        event.preventDefault();
        // Capture before React Flow's node handlers: arrows navigate the view
        // rather than persisting new positions for selected people.
        event.stopPropagation();
        const viewport = getViewport();
        const step = event.shiftKey ? 240 : 80;
        void setViewport({
          ...viewport,
          x: viewport.x - direction.x * step,
          y: viewport.y - direction.y * step,
        });
        return;
      }
      // '=' is the unshifted '+' key on many keyboards; numpad keys work too.
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-") {
        event.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomIn, zoomOut, getViewport, setViewport]);
}
