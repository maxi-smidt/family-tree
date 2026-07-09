import { useEffect } from "react";
import { useStoreApi } from "@xyflow/react";

interface Props {
  active: boolean;
}

/**
 * Keeps React Flow's multi-selection active for as long as the selection tool is
 * on. React Flow only toggles a node in/out of the current selection on click
 * when its multi-selection modifier is held; forcing that flag on lets a plain
 * click add an unselected member or remove an already-selected one — so people
 * can be dropped from a marquee selection without a modifier key (issue #620).
 *
 * Must be rendered inside <ReactFlow> so it can reach the flow store. `<ReactFlow>`
 * gets `multiSelectionKeyCode={null}` while active, so the built-in key handler
 * never flips the flag back off from under us.
 */
export const SelectionModeController = ({ active }: Props) => {
  const store = useStoreApi();

  useEffect(() => {
    if (!active) return;
    store.setState({ multiSelectionActive: true });
    return () => {
      store.setState({ multiSelectionActive: false });
    };
  }, [active, store]);

  return null;
};
