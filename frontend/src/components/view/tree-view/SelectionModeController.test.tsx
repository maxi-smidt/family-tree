import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import {
  ReactFlowProvider,
  useStore,
  useStoreApi,
  type ReactFlowState,
} from "@xyflow/react";
import { SelectionModeController } from "./SelectionModeController";

let multiSelectionActive = false;
let nodesSelectionActive = false;
let store: ReturnType<typeof useStoreApi<never, never>> | null = null;

function Probe() {
  multiSelectionActive = useStore((s: ReactFlowState) => s.multiSelectionActive);
  nodesSelectionActive = useStore((s: ReactFlowState) => s.nodesSelectionActive);
  store = useStoreApi();
  return null;
}

describe("SelectionModeController", () => {
  it("turns React Flow multi-selection on while active and off when inactive", () => {
    const { rerender } = render(
      <ReactFlowProvider>
        <SelectionModeController active={true} />
        <Probe />
      </ReactFlowProvider>,
    );
    expect(multiSelectionActive).toBe(true);

    rerender(
      <ReactFlowProvider>
        <SelectionModeController active={false} />
        <Probe />
      </ReactFlowProvider>,
    );
    expect(multiSelectionActive).toBe(false);
  });

  it("suppresses the persistent selection box while active", () => {
    render(
      <ReactFlowProvider>
        <SelectionModeController active={true} />
        <Probe />
      </ReactFlowProvider>,
    );

    // React Flow raises nodesSelectionActive when a marquee ends; the controller
    // must clear it again so the selection box never shows.
    act(() => {
      store?.setState({ nodesSelectionActive: true });
    });
    expect(nodesSelectionActive).toBe(false);
  });
});
