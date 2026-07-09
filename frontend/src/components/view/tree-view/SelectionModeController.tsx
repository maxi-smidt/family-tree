import { useEffect } from "react";
import { useStoreApi } from "@xyflow/react";

interface Props {
  active: boolean;
}

/**
 * Tweaks React Flow's selection behaviour for as long as the selection tool is
 * on. Rendered inside <ReactFlow> so it can reach the flow store.
 *
 * 1. Forces multi-selection active so a plain click toggles a member in/out of
 *    the selection (add if unselected, remove if selected) — the behaviour RF
 *    normally reserves for Ctrl/Cmd-click — so people can be dropped from a
 *    marquee selection without a modifier key (issue #620). `<ReactFlow>` also
 *    gets `multiSelectionKeyCode={null}` while active so the built-in key
 *    handler never flips the flag back off from under us.
 *
 * 2. Suppresses the persistent "selection box" (RF's NodesSelection overlay)
 *    that appears around a marquee selection. It is drawn on top of the selected
 *    nodes and swallows the very clicks used to add/remove individuals — only the
 *    rubber-band rectangle shown *while* dragging should remain. RF re-raises
 *    `nodesSelectionActive` every time a marquee ends, so we subscribe and clear
 *    it again synchronously (before paint) whenever it turns on.
 */
export const SelectionModeController = ({ active }: Props) => {
  const store = useStoreApi();

  useEffect(() => {
    if (!active) return;

    store.setState({ multiSelectionActive: true, nodesSelectionActive: false });

    const unsubscribe = store.subscribe(() => {
      if (store.getState().nodesSelectionActive) {
        store.setState({ nodesSelectionActive: false });
      }
    });

    return () => {
      unsubscribe();
      store.setState({ multiSelectionActive: false });
    };
  }, [active, store]);

  return null;
};
