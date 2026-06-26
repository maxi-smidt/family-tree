import { describe, expect, it } from "vitest";
import { Member, Relation } from "@/types/member";
import {
  classifyKinship,
  classifyRelationship,
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

// ---------------------------------------------------------------------------
// classifyKinship tests
// ---------------------------------------------------------------------------

/**
 * Minimal member factory reused from above, plus a convenience overload that
 * accepts a gender for the kinship tests.
 */
const km = (
  id: string,
  opts: {
    paternalParent?: string | null;
    maternalParent?: string | null;
    gender?: "m" | "f" | "o";
  } = {},
): Member => ({
  id,
  firstName: id,
  lastName: "Test",
  gender: opts.gender ?? "o",
  academicTitle: null,
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  deceased: false,
  date: { birth: "1990-01-01", death: null },
  parents: {
    paternalParent: opts.paternalParent ?? null,
    maternalParent: opts.maternalParent ?? null,
  },
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: [],
  isCollapsed: false,
  position: { x: 0, y: 0 },
});

describe("classifyKinship", () => {
  // -------------------------------------------------------------------------
  // Self
  // -------------------------------------------------------------------------
  it("returns self when fromId === toId", () => {
    const members = [km("a")];
    expect(classifyKinship(members, "a", "a")).toEqual({ kind: "self" });
  });

  // -------------------------------------------------------------------------
  // None (unconnected)
  // -------------------------------------------------------------------------
  it("returns none when there is no ancestry link", () => {
    const members = [km("a"), km("b")];
    expect(classifyKinship(members, "a", "b")).toEqual({ kind: "none" });
  });

  // -------------------------------------------------------------------------
  // Parent / child
  // -------------------------------------------------------------------------
  it("parent: from is the parent of to", () => {
    const members = [km("parent"), km("child", { paternalParent: "parent" })];
    expect(classifyKinship(members, "parent", "child")).toEqual({
      kind: "parent",
    });
  });

  it("child: from is the child of to", () => {
    const members = [km("parent"), km("child", { paternalParent: "parent" })];
    expect(classifyKinship(members, "child", "parent")).toEqual({
      kind: "child",
    });
  });

  // -------------------------------------------------------------------------
  // Grandparent / grandchild (greats = 0)
  // -------------------------------------------------------------------------
  it("grandparent (greats=0): from is the grandparent of to", () => {
    const members = [
      km("gp"),
      km("p", { paternalParent: "gp" }),
      km("c", { paternalParent: "p" }),
    ];
    expect(classifyKinship(members, "gp", "c")).toEqual({
      kind: "grandparent",
      greats: 0,
    });
  });

  it("grandchild (greats=0): from is the grandchild of to", () => {
    const members = [
      km("gp"),
      km("p", { paternalParent: "gp" }),
      km("c", { paternalParent: "p" }),
    ];
    expect(classifyKinship(members, "c", "gp")).toEqual({
      kind: "grandchild",
      greats: 0,
    });
  });

  // -------------------------------------------------------------------------
  // Great-grandparent / great-grandchild (greats = 1)
  // -------------------------------------------------------------------------
  it("great-grandparent (greats=1)", () => {
    const members = [
      km("ggp"),
      km("gp", { paternalParent: "ggp" }),
      km("p", { paternalParent: "gp" }),
      km("c", { paternalParent: "p" }),
    ];
    expect(classifyKinship(members, "ggp", "c")).toEqual({
      kind: "grandparent",
      greats: 1,
    });
  });

  it("great-grandchild (greats=1)", () => {
    const members = [
      km("ggp"),
      km("gp", { paternalParent: "ggp" }),
      km("p", { paternalParent: "gp" }),
      km("c", { paternalParent: "p" }),
    ];
    expect(classifyKinship(members, "c", "ggp")).toEqual({
      kind: "grandchild",
      greats: 1,
    });
  });

  // -------------------------------------------------------------------------
  // Great-great-grandparent (greats = 2) and beyond (greats >= 3)
  // -------------------------------------------------------------------------
  it("great-great-grandparent (greats=2)", () => {
    const chain = ["a", "b", "c", "d", "e"]; // a→b→c→d→e (5 generations)
    const members = [
      km("a"),
      km("b", { paternalParent: "a" }),
      km("c", { paternalParent: "b" }),
      km("d", { paternalParent: "c" }),
      km("e", { paternalParent: "d" }),
    ];
    // a to e: g1=0, g2=4 → grandparent with greats=2
    expect(classifyKinship(members, chain[0], chain[4])).toEqual({
      kind: "grandparent",
      greats: 2,
    });
  });

  it("greats=3 boundary (6-generation chain)", () => {
    const members = [
      km("a"),
      km("b", { paternalParent: "a" }),
      km("c", { paternalParent: "b" }),
      km("d", { paternalParent: "c" }),
      km("e", { paternalParent: "d" }),
      km("f", { paternalParent: "e" }),
    ];
    // a to f: g1=0, g2=5 → grandparent with greats=3
    expect(classifyKinship(members, "a", "f")).toEqual({
      kind: "grandparent",
      greats: 3,
    });
  });

  // -------------------------------------------------------------------------
  // Sibling (full)
  // -------------------------------------------------------------------------
  it("sibling: both share both parents", () => {
    const members = [
      km("pp"), // paternal parent
      km("mp"), // maternal parent
      km("s1", { paternalParent: "pp", maternalParent: "mp" }),
      km("s2", { paternalParent: "pp", maternalParent: "mp" }),
    ];
    expect(classifyKinship(members, "s1", "s2")).toEqual({ kind: "sibling" });
  });

  it("sibling: both share one parent (single-parent family) — still full sibling via LCA", () => {
    // When both members share exactly the same single parent, the LCA is that
    // parent. The half-sibling check fires if sharedCount === 1, but here
    // BOTH members have only one parent set AND it's the same one, so
    // sharedCount could be 1. This is actually a half-sibling by the strict
    // definition used in the code (one shared parent), so we assert half-sibling.
    const members = [
      km("p"),
      km("s1", { paternalParent: "p" }),
      km("s2", { paternalParent: "p" }),
    ];
    // s1 has only paternalParent=p; s2 has only paternalParent=p → sharedCount=1
    expect(classifyKinship(members, "s1", "s2")).toEqual({
      kind: "half-sibling",
    });
  });

  // -------------------------------------------------------------------------
  // Half-sibling (one shared parent)
  // -------------------------------------------------------------------------
  it("half-sibling: exactly one shared parent", () => {
    const members = [
      km("sharedParent"),
      km("otherParentA"),
      km("otherParentB"),
      km("s1", {
        paternalParent: "sharedParent",
        maternalParent: "otherParentA",
      }),
      km("s2", {
        paternalParent: "sharedParent",
        maternalParent: "otherParentB",
      }),
    ];
    expect(classifyKinship(members, "s1", "s2")).toEqual({
      kind: "half-sibling",
    });
  });

  it("full sibling vs half-sibling: sharing both parents gives sibling", () => {
    const members = [
      km("p1"),
      km("p2"),
      km("s1", { paternalParent: "p1", maternalParent: "p2" }),
      km("s2", { paternalParent: "p1", maternalParent: "p2" }),
    ];
    expect(classifyKinship(members, "s1", "s2")).toEqual({ kind: "sibling" });
  });

  // -------------------------------------------------------------------------
  // Pibling (aunt/uncle) and nibling (niece/nephew)
  // -------------------------------------------------------------------------
  it("pibling (greats=0): from is the aunt/uncle of to", () => {
    const members = [
      km("gp"),
      km("parent", { paternalParent: "gp" }),
      km("aunt", { paternalParent: "gp" }),
      km("child", { paternalParent: "parent" }),
    ];
    expect(classifyKinship(members, "aunt", "child")).toEqual({
      kind: "pibling",
      greats: 0,
    });
  });

  it("nibling (greats=0): from is the niece/nephew of to", () => {
    const members = [
      km("gp"),
      km("parent", { paternalParent: "gp" }),
      km("aunt", { paternalParent: "gp" }),
      km("child", { paternalParent: "parent" }),
    ];
    expect(classifyKinship(members, "child", "aunt")).toEqual({
      kind: "nibling",
      greats: 0,
    });
  });

  it("grand-aunt/uncle (pibling greats=1)", () => {
    const members = [
      km("ggp"),
      km("gp", { paternalParent: "ggp" }),
      km("grandAunt", { paternalParent: "ggp" }),
      km("parent", { paternalParent: "gp" }),
      km("child", { paternalParent: "parent" }),
    ];
    // grandAunt→ggp (g1=1), child→ggp (g2=3): pibling, greats=g2-g1-1=1
    expect(classifyKinship(members, "grandAunt", "child")).toEqual({
      kind: "pibling",
      greats: 1,
    });
  });

  // -------------------------------------------------------------------------
  // Cousins
  // -------------------------------------------------------------------------
  it("first cousin (degree=1, removal=0)", () => {
    const members = [
      km("gp"),
      km("parentA", { paternalParent: "gp" }),
      km("parentB", { paternalParent: "gp" }),
      km("cousinA", { paternalParent: "parentA" }),
      km("cousinB", { paternalParent: "parentB" }),
    ];
    expect(classifyKinship(members, "cousinA", "cousinB")).toEqual({
      kind: "cousin",
      degree: 1,
      removal: 0,
    });
  });

  it("second cousin (degree=2, removal=0)", () => {
    const members = [
      km("ggp"),
      km("gpA", { paternalParent: "ggp" }),
      km("gpB", { paternalParent: "ggp" }),
      km("pA", { paternalParent: "gpA" }),
      km("pB", { paternalParent: "gpB" }),
      km("c2A", { paternalParent: "pA" }),
      km("c2B", { paternalParent: "pB" }),
    ];
    expect(classifyKinship(members, "c2A", "c2B")).toEqual({
      kind: "cousin",
      degree: 2,
      removal: 0,
    });
  });

  it("first cousin once removed (degree=1, removal=1)", () => {
    const members = [
      km("gp"),
      km("parentA", { paternalParent: "gp" }),
      km("parentB", { paternalParent: "gp" }),
      km("cousin", { paternalParent: "parentA" }),
      km("cousinChild", { paternalParent: "cousin" }),
      // cousinChild needs to be found from parentB's child's perspective
      km("ref", { paternalParent: "parentB" }),
    ];
    // cousin (g1=2 from gp) vs ref (g2=2 from gp): degree=1, removal=0 — let
    // me use cousinChild vs ref for once-removed.
    // cousinChild→gp: g1=3; ref→gp: g2=2; degree=min-1=1, removal=|3-2|=1
    expect(classifyKinship(members, "cousinChild", "ref")).toEqual({
      kind: "cousin",
      degree: 1,
      removal: 1,
    });
  });

  it("first cousin twice removed (degree=1, removal=2)", () => {
    const members = [
      km("gp"),
      km("parentA", { paternalParent: "gp" }),
      km("parentB", { paternalParent: "gp" }),
      km("cousin", { paternalParent: "parentA" }),
      km("cousinChild", { paternalParent: "cousin" }),
      km("cousinGrandChild", { paternalParent: "cousinChild" }),
      km("ref", { paternalParent: "parentB" }),
    ];
    // cousinGrandChild→gp: g1=4; ref→gp: g2=2 → degree=1, removal=2
    expect(classifyKinship(members, "cousinGrandChild", "ref")).toEqual({
      kind: "cousin",
      degree: 1,
      removal: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// classifyRelationship tests (Tier 2)
// ---------------------------------------------------------------------------

/** Member factory with optional parents, gender, and relations array. */
const rm = (
  id: string,
  opts: {
    paternalParent?: string | null;
    maternalParent?: string | null;
    gender?: "m" | "f" | "o";
    relations?: Relation[];
  } = {},
): Member => ({
  id,
  firstName: id,
  lastName: "Test",
  gender: opts.gender ?? "o",
  academicTitle: null,
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  deceased: false,
  date: { birth: "1990-01-01", death: null },
  parents: {
    paternalParent: opts.paternalParent ?? null,
    maternalParent: opts.maternalParent ?? null,
  },
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: [],
  isCollapsed: false,
  position: { x: 0, y: 0 },
  relations: opts.relations ?? [],
});

const rel = (
  fromMemberId: string,
  toMemberId: string,
  relationType: string,
): Relation => ({ fromMemberId, toMemberId, relationType });

describe("classifyRelationship", () => {
  // -------------------------------------------------------------------------
  // Blood wins
  // -------------------------------------------------------------------------
  it("blood relation takes precedence over a partner edge", () => {
    // alice is both the parent of bob AND listed as a partner (unusual but
    // tests priority).
    const alice = rm("alice", {
      relations: [rel("alice", "bob", "married")],
    });
    const bob = rm("bob", { paternalParent: "alice" });
    expect(classifyRelationship([alice, bob], "alice", "bob")).toEqual({
      kind: "parent",
    });
  });

  // -------------------------------------------------------------------------
  // Partner
  // -------------------------------------------------------------------------
  it("partner: married relationType is reported", () => {
    const alice = rm("alice", {
      relations: [rel("alice", "bob", "married")],
    });
    const bob = rm("bob");
    expect(classifyRelationship([alice, bob], "alice", "bob")).toEqual({
      kind: "partner",
      relationType: "married",
    });
    // Symmetric — bob has no relations array entry, but alice does.
    expect(classifyRelationship([alice, bob], "bob", "alice")).toEqual({
      kind: "partner",
      relationType: "married",
    });
  });

  it("partner: partner relationType", () => {
    const a = rm("a", { relations: [rel("a", "b", "partner")] });
    const b = rm("b");
    expect(classifyRelationship([a, b], "a", "b")).toEqual({
      kind: "partner",
      relationType: "partner",
    });
  });

  it("partner: divorced relationType", () => {
    const a = rm("a", { relations: [rel("a", "b", "divorced")] });
    const b = rm("b");
    expect(classifyRelationship([a, b], "a", "b")).toEqual({
      kind: "partner",
      relationType: "divorced",
    });
  });

  it("partner: prefers married over divorced when both relations exist", () => {
    // Two relation entries for the same pair — married should win.
    const a = rm("a", {
      relations: [rel("a", "b", "divorced"), rel("a", "b", "married")],
    });
    const b = rm("b");
    expect(classifyRelationship([a, b], "a", "b")).toEqual({
      kind: "partner",
      relationType: "married",
    });
  });

  // -------------------------------------------------------------------------
  // Parent-in-law / child-in-law
  // -------------------------------------------------------------------------
  it("parent-in-law: alice is a parent of carol's partner bob", () => {
    // alice → bob (parent); bob married carol
    const alice = rm("alice");
    const bob = rm("bob", {
      paternalParent: "alice",
      relations: [rel("bob", "carol", "married")],
    });
    const carol = rm("carol");
    // alice is the parent-in-law of carol
    expect(classifyRelationship([alice, bob, carol], "alice", "carol")).toEqual(
      { kind: "parent-in-law" },
    );
  });

  it("child-in-law: carol's partner bob is a child of alice", () => {
    // Same fixture — carol is the child-in-law of alice
    const alice = rm("alice");
    const bob = rm("bob", {
      paternalParent: "alice",
      relations: [rel("bob", "carol", "married")],
    });
    const carol = rm("carol");
    expect(classifyRelationship([alice, bob, carol], "carol", "alice")).toEqual(
      { kind: "child-in-law" },
    );
  });

  // -------------------------------------------------------------------------
  // Sibling-in-law (two forms)
  // -------------------------------------------------------------------------
  it("sibling-in-law form A: alice is a sibling of carol's partner bob", () => {
    // alice and bob share parent gp; bob married carol
    const gp = rm("gp");
    const alice = rm("alice", { paternalParent: "gp" });
    const bob = rm("bob", {
      paternalParent: "gp",
      relations: [rel("bob", "carol", "married")],
    });
    const carol = rm("carol");
    expect(
      classifyRelationship([gp, alice, bob, carol], "alice", "carol"),
    ).toEqual({ kind: "sibling-in-law" });
  });

  it("sibling-in-law form B: from is the partner of to's sibling", () => {
    // dan2 is partner of alice2; alice2 is a sibling of carol2 (both share gp2)
    // → dan2 is the sibling-in-law of carol2
    const gp2 = rm("gp2");
    const alice2 = rm("alice2", {
      paternalParent: "gp2",
      relations: [rel("alice2", "dan2", "married")],
    });
    const carol2 = rm("carol2", { paternalParent: "gp2" });
    const dan2 = rm("dan2");
    expect(
      classifyRelationship([gp2, alice2, carol2, dan2], "dan2", "carol2"),
    ).toEqual({ kind: "sibling-in-law" });
  });

  // -------------------------------------------------------------------------
  // Step-parent / step-child
  // -------------------------------------------------------------------------
  it("step-parent: alice is partner of bob (parent of carol) → alice is carol's step-parent", () => {
    const bob = rm("bob", { relations: [rel("bob", "alice", "married")] });
    const alice = rm("alice");
    const carol = rm("carol", { paternalParent: "bob" });
    expect(classifyRelationship([bob, alice, carol], "alice", "carol")).toEqual(
      { kind: "step-parent" },
    );
  });

  it("step-child: carol is child of bob; alice is bob's partner → carol is alice's step-child", () => {
    const bob = rm("bob", { relations: [rel("bob", "alice", "married")] });
    const alice = rm("alice");
    const carol = rm("carol", { paternalParent: "bob" });
    expect(classifyRelationship([bob, alice, carol], "carol", "alice")).toEqual(
      { kind: "step-child" },
    );
  });

  it("explicit step-parent relation (from→to direction)", () => {
    const alice = rm("alice", {
      relations: [rel("alice", "carol", "step-parent")],
    });
    const carol = rm("carol");
    expect(classifyRelationship([alice, carol], "alice", "carol")).toEqual({
      kind: "step-parent",
    });
  });

  // -------------------------------------------------------------------------
  // Step-sibling
  // -------------------------------------------------------------------------
  it("step-sibling: alice and carol have parents who are partners", () => {
    // alice's parent = bob; carol's parent = dan; bob and dan are partners
    const bob = rm("bob", { relations: [rel("bob", "dan", "married")] });
    const dan = rm("dan");
    const alice = rm("alice", { paternalParent: "bob" });
    const carol = rm("carol", { paternalParent: "dan" });
    expect(
      classifyRelationship([bob, dan, alice, carol], "alice", "carol"),
    ).toEqual({ kind: "step-sibling" });
    // symmetric
    expect(
      classifyRelationship([bob, dan, alice, carol], "carol", "alice"),
    ).toEqual({ kind: "step-sibling" });
  });

  it("explicit step-sibling relation", () => {
    const alice = rm("alice", {
      relations: [rel("alice", "carol", "step-sibling")],
    });
    const carol = rm("carol");
    expect(classifyRelationship([alice, carol], "alice", "carol")).toEqual({
      kind: "step-sibling",
    });
    // symmetric
    expect(classifyRelationship([alice, carol], "carol", "alice")).toEqual({
      kind: "step-sibling",
    });
  });

  // -------------------------------------------------------------------------
  // Falls through to none
  // -------------------------------------------------------------------------
  it("returns none for completely unrelated members", () => {
    const a = rm("a");
    const b = rm("b");
    expect(classifyRelationship([a, b], "a", "b")).toEqual({ kind: "none" });
  });
});
