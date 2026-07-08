import { describe, it, expect } from "vitest";
import {
  getRuledLinePattern,
  GENERATION_LINE_GAP,
} from "@/components/view/tree-view/GenerationLines";

describe("getRuledLinePattern", () => {
  it("scales the gap by the zoom level", () => {
    expect(getRuledLinePattern([0, 0, 1], 250).scaledGap).toBe(250);
    expect(getRuledLinePattern([0, 0, 2], 250).scaledGap).toBe(500);
    expect(getRuledLinePattern([0, 0, 0.5], 250).scaledGap).toBe(125);
  });

  it("falls back to a 1px gap when the scaled gap would be zero", () => {
    expect(getRuledLinePattern([0, 0, 0], 250).scaledGap).toBe(1);
  });

  it("offsets vertically by the panned y within one gap", () => {
    // zoom 1, gap 250, panned 300 -> 300 % 250 = 50
    expect(getRuledLinePattern([0, 300, 1], 250).offsetY).toBe(50);
    expect(getRuledLinePattern([0, 250, 1], 250).offsetY).toBe(0);
  });

  it("exposes a sensible default generation gap", () => {
    expect(GENERATION_LINE_GAP).toBe(250);
  });
});
