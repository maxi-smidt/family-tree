import { describe, expect, it } from "vitest";
import type { Member } from "@/types/member";
import { buildEdges } from "@/workers/treeProcessor.worker";
import type { WorkerUnionInfo } from "@/workers/treeProcessor.types";

function member(
  id: string,
  x: number,
  relations: Member["relations"] = [],
): Member {
  return {
    id,
    gender: "o",
    academicTitle: null,
    firstName: id,
    middleNames: null,
    baptismalName: null,
    lastName: "Test",
    maidenName: null,
    imageData: null,
    deceased: false,
    date: { birth: "", death: null },
    parents: { paternalParent: null, maternalParent: null },
    additionalData: null,
    birthplace: null,
    hometown: null,
    placesLived: [],
    isCollapsed: false,
    position: { x, y: 0 },
    relations,
  };
}

describe("treeProcessor worker edge styles", () => {
  it("applies relation type style overrides to couple edges", () => {
    const members = [member("a", 0), member("b", 300)];
    const unions: WorkerUnionInfo[] = [
      {
        id: "union-a-b",
        partner1Id: "a",
        partner2Id: "b",
        childIds: [],
        relationType: "married",
      },
    ];

    const edges = buildEdges(
      members,
      unions,
      ["parent", "married"],
      "smoothstep",
      {
        married: {
          color: "#123456",
          strokeDasharray: "2,4",
          strokeWidth: 5,
        },
      },
    );

    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.baseStyle)).toEqual([
      { stroke: "#123456", strokeDasharray: "2,4", strokeWidth: 5 },
      { stroke: "#123456", strokeDasharray: "2,4", strokeWidth: 5 },
    ]);
  });

  it("applies relation type style overrides to ordinary relation edges", () => {
    const members = [
      member("a", 0, [
        { fromMemberId: "a", toMemberId: "b", relationType: "godparent" },
      ]),
      member("b", 300),
    ];

    const edges = buildEdges(members, [], ["godparent"], "smoothstep", {
      godparent: {
        color: "#654321",
        strokeDasharray: "0",
        strokeWidth: 3,
      },
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].baseStyle).toEqual({
      stroke: "#654321",
      strokeDasharray: "0",
      strokeWidth: 3,
    });
  });
});
