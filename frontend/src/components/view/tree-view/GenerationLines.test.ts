import { describe, it, expect } from "vitest";
import { getGenerationLines } from "@/components/view/tree-view/GenerationLines";
import { NODE_WIDTH, NODE_HEIGHT } from "@/constants";

describe("getGenerationLines", () => {
  it("returns null for an empty node list", () => {
    expect(getGenerationLines([])).toBeNull();
  });

  it("returns deduped, sorted line centers for distinct generation ys", () => {
    const nodes = [
      { position: { x: 0, y: 0 } },
      { position: { x: 300, y: 200 } },
      { position: { x: 150, y: 0 } },
    ];

    const result = getGenerationLines(nodes);

    expect(result).not.toBeNull();
    expect(result?.lineYs).toEqual([
      0 + NODE_HEIGHT / 2,
      200 + NODE_HEIGHT / 2,
    ]);
  });

  it("computes xStart/xEnd from the min/max x plus padding", () => {
    const nodes = [
      { position: { x: 0, y: 0 } },
      { position: { x: 300, y: 200 } },
      { position: { x: 150, y: 0 } },
    ];

    const result = getGenerationLines(nodes);

    expect(result).not.toBeNull();
    expect(result?.xStart).toBe(0 - 80);
    expect(result?.xEnd).toBe(300 + NODE_WIDTH + 80);
  });
});
