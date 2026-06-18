import { describe, expect, it } from "vitest";
import { Member, Relation } from "@/types/member";
import {
  findConnectionPathHighlight,
  findShortestMemberPath,
  buildMemberConnectionGraph,
  memberPairKey,
  pruneConnectionMemberIds,
} from "./graphUtils";

const member = (
  id: string,
  options: {
    paternalParent?: string | null;
    maternalParent?: string | null;
    relations?: Relation[];
  } = {},
): Member => ({
  id,
  firstName: id,
  lastName: "Member",
  gender: "o",
  academicTitle: null,
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  deceased: false,
  date: { birth: "1990-01-01", death: null },
  parents: {
    paternalParent: options.paternalParent ?? null,
    maternalParent: options.maternalParent ?? null,
  },
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: [],
  isCollapsed: false,
  position: { x: 0, y: 0 },
  relations: options.relations,
});

describe("member connection graph", () => {
  it("finds an undirected parent-child path", () => {
    const graph = buildMemberConnectionGraph([
      member("parent"),
      member("child", { paternalParent: "parent" }),
    ]);

    expect(findShortestMemberPath(graph, "parent", "child")).toEqual([
      "parent",
      "child",
    ]);
    expect(findShortestMemberPath(graph, "child", "parent")).toEqual([
      "child",
      "parent",
    ]);
  });

  it("uses explicit horizontal relationships", () => {
    const members = [
      member("alex", {
        relations: [
          {
            fromMemberId: "alex",
            toMemberId: "sam",
            relationType: "partner",
          },
        ],
      }),
      member("sam"),
    ];

    const highlight = findConnectionPathHighlight(members, ["alex", "sam"]);

    expect(highlight.nodeIds).toEqual(new Set(["alex", "sam"]));
    expect(highlight.edgeKeys).toEqual(new Set([memberPairKey("alex", "sam")]));
    expect(highlight.missingPairs).toEqual([]);
  });

  it("connects siblings through their shared parent", () => {
    const members = [
      member("parent"),
      member("older", { paternalParent: "parent" }),
      member("younger", { paternalParent: "parent" }),
    ];

    const graph = buildMemberConnectionGraph(members);

    expect(findShortestMemberPath(graph, "older", "younger")).toEqual([
      "older",
      "parent",
      "younger",
    ]);
  });

  it("highlights the union of pairwise paths for multiple selected members", () => {
    const members = [
      member("grandparent"),
      member("parent", { paternalParent: "grandparent" }),
      member("child", { paternalParent: "parent" }),
    ];

    const highlight = findConnectionPathHighlight(members, [
      "grandparent",
      "parent",
      "child",
    ]);

    expect(highlight.nodeIds).toEqual(
      new Set(["grandparent", "parent", "child"]),
    );
    expect(highlight.edgeKeys).toEqual(
      new Set([
        memberPairKey("grandparent", "parent"),
        memberPairKey("parent", "child"),
      ]),
    );
  });

  it("reports disconnected selected members", () => {
    const highlight = findConnectionPathHighlight(
      [member("one"), member("two")],
      ["one", "two"],
    );

    expect(highlight.nodeIds).toEqual(new Set());
    expect(highlight.edgeKeys).toEqual(new Set());
    expect(highlight.missingPairs).toEqual([{ fromId: "one", toId: "two" }]);
  });
});

describe("pruneConnectionMemberIds", () => {
  it("returns the same array reference when nothing was removed", () => {
    const members = [member("a"), member("b"), member("c")];
    const ids = ["a", "b", "c"];
    const result = pruneConnectionMemberIds(ids, members);
    expect(result).toBe(ids);
  });

  it("filters out ids that are no longer in members", () => {
    const members = [member("a"), member("c")];
    const ids = ["a", "b", "c"];
    const result = pruneConnectionMemberIds(ids, members);
    expect(result).toEqual(["a", "c"]);
    expect(result).not.toBe(ids);
  });

  it("preserves order of remaining ids", () => {
    const members = [member("a"), member("c"), member("e")];
    const ids = ["e", "c", "a"];
    const result = pruneConnectionMemberIds(ids, members);
    expect(result).toEqual(["e", "c", "a"]);
  });

  it("returns empty array when all ids are removed", () => {
    const members = [member("x"), member("y")];
    const ids = ["a", "b", "c"];
    const result = pruneConnectionMemberIds(ids, members);
    expect(result).toEqual([]);
  });

  it("returns same reference for empty ids array", () => {
    const members = [member("a")];
    const ids: string[] = [];
    const result = pruneConnectionMemberIds(ids, members);
    expect(result).toBe(ids);
  });
});
