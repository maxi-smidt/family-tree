import { describe, expect, it } from "vitest";
import { NODE_HEIGHT } from "@/constants";
import { UNION_NODE_SIZE } from "@/components/view/tree-view/node/UnionNode";
import { getUnionChildCenterY } from "@/components/view/tree-view/edge/UnionChildEdge";

describe("getUnionChildCenterY", () => {
  // Parents at y = 0, so the union dot's bottom handle is at mid-height + half a dot.
  const sourceY = NODE_HEIGHT / 2 + UNION_NODE_SIZE / 2;

  it("centers the bend between the parents' bottom and the child's top", () => {
    const childTop = 325;
    expect(getUnionChildCenterY(sourceY, childTop)).toBe(
      (NODE_HEIGHT + childTop) / 2,
    );
  });

  it("leaves the default routing when the child is not below the parents", () => {
    expect(getUnionChildCenterY(sourceY, NODE_HEIGHT)).toBeUndefined();
    expect(getUnionChildCenterY(sourceY, -200)).toBeUndefined();
  });
});
