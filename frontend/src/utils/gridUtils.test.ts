import { describe, expect, it } from "vitest";
import { GRID_SIZE, NODE_HEIGHT, NODE_WIDTH } from "@/constants";
import { GRID_DOT_SIZE, getGridDotOffset, snapToGrid } from "@/utils/gridUtils";
import { createMember } from "@/types/member";

describe("snapToGrid", () => {
  it("rounds both axes to the nearest grid cell", () => {
    expect(snapToGrid({ x: GRID_SIZE * 2 + 3, y: GRID_SIZE * 3 - 4 })).toEqual({
      x: GRID_SIZE * 2,
      y: GRID_SIZE * 3,
    });
  });

  it("keeps positions already on the grid", () => {
    expect(snapToGrid({ x: -GRID_SIZE, y: 0 })).toEqual({
      x: -GRID_SIZE,
      y: 0,
    });
  });
});

describe("member positions", () => {
  it("places a new member on the grid", () => {
    const { position } = createMember({ x: 517.3, y: 211.8 });
    expect(position.x % GRID_SIZE).toBe(0);
    expect(position.y % GRID_SIZE).toBe(0);
  });
});

describe("getGridDotOffset", () => {
  // Where React Flow's dot <Background> draws its dots (flow units, mod gap).
  const dotPhase = (offset: number) =>
    (((-GRID_SIZE / 2 - offset + GRID_DOT_SIZE / 2) % GRID_SIZE) + GRID_SIZE) %
    GRID_SIZE;

  it("puts a dot on the center of every snapped card", () => {
    const [x, y] = getGridDotOffset();
    expect(dotPhase(x)).toBeCloseTo((NODE_WIDTH / 2) % GRID_SIZE);
    expect(dotPhase(y)).toBeCloseTo((NODE_HEIGHT / 2) % GRID_SIZE);
  });

  it("stays non-negative so React Flow's translate() remains valid", () => {
    for (const offset of getGridDotOffset()) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(GRID_SIZE);
    }
  });
});
