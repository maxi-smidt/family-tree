import { describe, it, expect } from "vitest";
import {
  getRuledLinePattern,
  GENERATION_LINE_GAP,
} from "@/components/view/tree-view/GenerationLines";

describe("getRuledLinePattern", () => {
  it("scales the gap by the zoom level", () => {
    expect(getRuledLinePattern([0, 0, 1], 500).scaledGap).toBe(500);
    expect(getRuledLinePattern([0, 0, 2], 500).scaledGap).toBe(1000);
    expect(getRuledLinePattern([0, 0, 0.5], 500).scaledGap).toBe(250);
  });

  it("falls back to a 1px gap when the scaled gap would be zero", () => {
    expect(getRuledLinePattern([0, 0, 0], 500).scaledGap).toBe(1);
  });

  it("offsets vertically by the panned y within one gap", () => {
    // zoom 1, gap 500, panned 600 -> 600 % 500 = 100
    expect(getRuledLinePattern([0, 600, 1], 500).offsetY).toBe(100);
    expect(getRuledLinePattern([0, 500, 1], 500).offsetY).toBe(0);
  });

  it("applies a flow-space phase (scaled by zoom) so lines sit on node centers", () => {
    expect(getRuledLinePattern([0, 0, 1], 500, 72.5).offsetY).toBe(72.5);
    expect(getRuledLinePattern([0, 0, 2], 500, 72.5).offsetY).toBe(145);
  });

  it("exposes a doubled default generation gap", () => {
    expect(GENERATION_LINE_GAP).toBe(500);
  });
});
