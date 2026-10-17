import { describe, expect, it } from "vitest";
import { GRID_SIZE } from "@/constants";
import { snapToGrid } from "@/utils/gridUtils";
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
