import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { NODE_HEIGHT, NODE_WIDTH } from "@/constants";
import { computeNodesBounds } from "./flowFit";

function node(
  partial: Partial<Node> & { id: string; position: { x: number; y: number } },
): Node {
  return { data: {}, ...partial } as Node;
}

describe("computeNodesBounds", () => {
  it("returns null when there are no nodes", () => {
    expect(computeNodesBounds([])).toBeNull();
  });

  it("returns null when every node is hidden", () => {
    expect(
      computeNodesBounds([
        node({ id: "a", position: { x: 0, y: 0 }, hidden: true }),
      ]),
    ).toBeNull();
  });

  it("falls back to the default card size for unmeasured nodes", () => {
    // Off-screen nodes culled by onlyRenderVisibleElements are never measured.
    expect(
      computeNodesBounds([node({ id: "a", position: { x: 0, y: 0 } })]),
    ).toEqual({ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  it("uses measured dimensions when present", () => {
    expect(
      computeNodesBounds([
        node({
          id: "a",
          position: { x: 10, y: 20 },
          measured: { width: 100, height: 50 },
        }),
      ]),
    ).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("spans every visible node and ignores hidden ones", () => {
    expect(
      computeNodesBounds([
        node({
          id: "a",
          position: { x: 0, y: 0 },
          measured: { width: 100, height: 100 },
        }),
        node({
          id: "b",
          position: { x: 400, y: 300 },
          measured: { width: 100, height: 100 },
        }),
        node({ id: "hidden", position: { x: 5000, y: 5000 }, hidden: true }),
      ]),
    ).toEqual({ x: 0, y: 0, width: 500, height: 400 });
  });
});
