import { describe, expect, it } from "vitest";
import { Node } from "@xyflow/react";
import { Member } from "@/types/member";
import { buildMemberNodes } from "./memberNodes";

const member = (id: string, x = 0, y = 0): Member =>
  ({ id, position: { x, y } }) as unknown as Member;

describe("buildMemberNodes", () => {
  it("keeps the measured size so React Flow never treats cards as unmeasured", () => {
    const prev: Node[] = [
      {
        id: "a",
        position: { x: 0, y: 0 },
        data: {},
        measured: { width: 220, height: 64 },
      },
    ];

    const [node] = buildMemberNodes([member("a", 300, 0)], prev);

    expect(node.position).toEqual({ x: 300, y: 0 });
    expect(node.measured).toEqual({ width: 220, height: 64 });
  });

  it("carries the selection over", () => {
    const prev: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {}, selected: true },
      { id: "b", position: { x: 0, y: 0 }, data: {} },
    ];

    const nodes = buildMemberNodes([member("a"), member("b")], prev);

    expect(nodes.map((n) => n.selected)).toEqual([true, false]);
  });

  it("leaves new members unmeasured", () => {
    const [node] = buildMemberNodes([member("new")], []);

    expect(node).not.toHaveProperty("measured");
    expect(node.type).toBe("familyMember");
  });
});
