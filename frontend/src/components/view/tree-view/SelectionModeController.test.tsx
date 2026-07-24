import { describe, expect, it } from "vitest";
import { useStore, useStoreApi, type ReactFlowState } from "@xyflow/react";
import { act, renderWithProviders } from "@/test/utils";
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
    const { rerender } = renderWithProviders(
      <>
        <SelectionModeController active={true} />
        <Probe />
      </>,
      { reactFlow: true },
    );
    expect(multiSelectionActive).toBe(true);

    rerender(
      <>
        <SelectionModeController active={false} />
        <Probe />
      </>,
    );
    expect(multiSelectionActive).toBe(false);
  });

  it("suppresses the persistent selection box while active", () => {
    renderWithProviders(
      <>
        <SelectionModeController active={true} />
        <Probe />
      </>,
      { reactFlow: true },
    );

    // React Flow raises nodesSelectionActive when a marquee ends; the controller
    // must clear it again so the selection box never shows.
    act(() => {
      store?.setState({ nodesSelectionActive: true });
    });
    expect(nodesSelectionActive).toBe(false);
  });
});
