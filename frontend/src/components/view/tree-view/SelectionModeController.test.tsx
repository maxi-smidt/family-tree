import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider, useStore } from "@xyflow/react";
import { SelectionModeController } from "./SelectionModeController";

let latest = false;

function Probe() {
  latest = useStore((s) => s.multiSelectionActive);
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
    expect(latest).toBe(true);

    rerender(
      <ReactFlowProvider>
        <SelectionModeController active={false} />
        <Probe />
      </ReactFlowProvider>,
    );
    expect(latest).toBe(false);
  });
});
