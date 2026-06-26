import { Member } from "@/types/member";

// ---------------------------------------------------------------------------
// Kinship classification — directed, typed, pure (no React, no i18n)
// ---------------------------------------------------------------------------

export type KinshipRelation =
  | { kind: "self" }
  | { kind: "parent" | "child" | "sibling" | "half-sibling" }
  | {
      kind: "grandparent" | "grandchild";
      /** Extra "great" levels. 0 = grand, 1 = great-grand, 2 = great-great-grand … */
      greats: number;
    }
  | {
      kind: "pibling" | "nibling";
      /** Extra "great" levels. 0 = ordinary aunt/uncle or niece/nephew. */
      greats: number;
    }
  | { kind: "cousin"; degree: number; removal: number }
  | { kind: "none" };

/**
 * BFS upward over `paternalParent` / `maternalParent`, recording the minimum
 * generation distance from `startId` to every ancestor (including itself at 0).
 */
export function computeAncestorDepths(
  members: Member[],
  startId: string,
): Map<string, number> {
  const memberMap = new Map<string, Member>(members.map((m) => [m.id, m]));
  const depths = new Map<string, number>();

  const queue: Array<{ id: string; depth: number }> = [
    { id: startId, depth: 0 },
  ];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depths.has(id)) continue;
    depths.set(id, depth);

    const m = memberMap.get(id);
    if (!m) continue;

    const parents = [m.parents.paternalParent, m.parents.maternalParent];
    for (const parentId of parents) {
      if (parentId && !depths.has(parentId)) {
        queue.push({ id: parentId, depth: depth + 1 });
      }
    }
  }

  return depths;
}

/**
 * Classify the kinship of `fromId` **relative to** `toId`
 * (i.e. "fromId is the <result.kind> of toId").
 *
 * Uses only the parent graph (paternalParent / maternalParent).
 */
export function classifyKinship(
  members: Member[],
  fromId: string,
  toId: string,
): KinshipRelation {
  if (fromId === toId) return { kind: "self" };

  const fromDepths = computeAncestorDepths(members, fromId);
  const toDepths = computeAncestorDepths(members, toId);

  // Find common ancestors and the LCA(s) minimising g1+g2.
  let minSum = Infinity;
  for (const [ancId, g1] of fromDepths) {
    if (!toDepths.has(ancId)) continue;
    const g2 = toDepths.get(ancId)!;
    if (g1 + g2 < minSum) minSum = g1 + g2;
  }

  if (minSum === Infinity) return { kind: "none" };

  // Collect all LCAs with that minimum sum.
  const lcas: Array<{ ancId: string; g1: number; g2: number }> = [];
  for (const [ancId, g1] of fromDepths) {
    if (!toDepths.has(ancId)) continue;
    const g2 = toDepths.get(ancId)!;
    if (g1 + g2 === minSum) lcas.push({ ancId, g1, g2 });
  }

  // Use the first LCA for depth calculations (all LCAs share the same g1+g2).
  const { g1, g2 } = lcas[0];

  // --- Direct line ---
  if (g1 === 0) {
    // from is an ancestor of to
    if (g2 === 1) return { kind: "parent" };
    return { kind: "grandparent", greats: g2 - 2 };
  }
  if (g2 === 0) {
    // from is a descendant of to
    if (g1 === 1) return { kind: "child" };
    return { kind: "grandchild", greats: g1 - 2 };
  }

  // --- Siblings ---
  if (g1 === 1 && g2 === 1) {
    // Check half-sibling: share exactly one parent (look directly at parent ids).
    const memberMap = new Map<string, Member>(members.map((m) => [m.id, m]));
    const fromMember = memberMap.get(fromId);
    const toMember = memberMap.get(toId);
    if (fromMember && toMember) {
      const fromParents = new Set(
        [
          fromMember.parents.paternalParent,
          fromMember.parents.maternalParent,
        ].filter(Boolean),
      );
      const toParents = [
        toMember.parents.paternalParent,
        toMember.parents.maternalParent,
      ].filter(Boolean);
      const sharedCount = toParents.filter((p) => fromParents.has(p!)).length;
      if (sharedCount === 1) return { kind: "half-sibling" };
    }
    return { kind: "sibling" };
  }

  // --- Aunts/uncles and nieces/nephews (pibling / nibling) ---
  // One side is at depth 1 (parent of LCA), the other is deeper.
  if (Math.min(g1, g2) === 1 && Math.abs(g1 - g2) >= 1) {
    if (g1 < g2) {
      // from is closer to LCA → from is the aunt/uncle (pibling)
      return { kind: "pibling", greats: g2 - g1 - 1 };
    } else {
      // to is closer to LCA → from is the niece/nephew (nibling)
      return { kind: "nibling", greats: g1 - g2 - 1 };
    }
  }

  // --- Cousins ---
  if (Math.min(g1, g2) >= 2) {
    return {
      kind: "cousin",
      degree: Math.min(g1, g2) - 1,
      removal: Math.abs(g1 - g2),
    };
  }

  return { kind: "none" };
}

/**
 * Filter `currentIds` to those still present in `members`.
 *
 * Returns the SAME array reference when nothing was removed (identity
 * preserved), mirroring the existing effect in FlowPanel that prunes
 * connectionMemberIds.
 */
export function pruneConnectionMemberIds(
  currentIds: string[],
  members: Member[],
): string[] {
  const memberIds = new Set(members.map((m) => m.id));
  const filtered = currentIds.filter((id) => memberIds.has(id));
  return filtered.length === currentIds.length ? currentIds : filtered;
}

export interface MissingConnectionPair {
  fromId: string;
  toId: string;
}

export interface ConnectionPathHighlight {
  nodeIds: Set<string>;
  edgeKeys: Set<string>;
  missingPairs: MissingConnectionPair[];
}

type MemberGraph = Map<string, Set<string>>;

export const memberPairKey = (a: string, b: string) =>
  a.localeCompare(b) <= 0 ? `${a}|${b}` : `${b}|${a}`;

export function buildMemberConnectionGraph(members: Member[]): MemberGraph {
  const memberIds = new Set(members.map((member) => member.id));
  const graph: MemberGraph = new Map(
    members.map((member) => [member.id, new Set<string>()]),
  );

  const addEdge = (fromId: string | null, toId: string | null) => {
    if (!fromId || !toId || fromId === toId) return;
    if (!memberIds.has(fromId) || !memberIds.has(toId)) return;
    graph.get(fromId)?.add(toId);
    graph.get(toId)?.add(fromId);
  };

  for (const member of members) {
    addEdge(member.id, member.parents.paternalParent);
    addEdge(member.id, member.parents.maternalParent);

    for (const relation of member.relations ?? []) {
      addEdge(member.id, relation.toMemberId);
    }
  }

  return graph;
}

export function findShortestMemberPath(
  graph: MemberGraph,
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return [fromId];
  if (!graph.has(fromId) || !graph.has(toId)) return null;

  const queue = [fromId];
  const previous = new Map<string, string | null>([[fromId, null]]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const neighbors = Array.from(graph.get(currentId) ?? []).sort();

    for (const neighborId of neighbors) {
      if (previous.has(neighborId)) continue;
      previous.set(neighborId, currentId);

      if (neighborId === toId) {
        const path = [toId];
        let step = currentId;
        while (step) {
          path.push(step);
          step = previous.get(step) ?? "";
        }
        return path.reverse();
      }

      queue.push(neighborId);
    }
  }

  return null;
}

export function findConnectionPathHighlight(
  members: Member[],
  selectedMemberIds: string[],
): ConnectionPathHighlight {
  const graph = buildMemberConnectionGraph(members);
  const validSelectedIds = selectedMemberIds.filter(
    (id, index) => graph.has(id) && selectedMemberIds.indexOf(id) === index,
  );
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const missingPairs: MissingConnectionPair[] = [];

  if (validSelectedIds.length < 2) {
    return { nodeIds, edgeKeys, missingPairs };
  }

  for (let i = 0; i < validSelectedIds.length; i += 1) {
    for (let j = i + 1; j < validSelectedIds.length; j += 1) {
      const fromId = validSelectedIds[i];
      const toId = validSelectedIds[j];
      const path = findShortestMemberPath(graph, fromId, toId);

      if (!path) {
        missingPairs.push({ fromId, toId });
        continue;
      }

      path.forEach((id) => nodeIds.add(id));
      for (let k = 0; k < path.length - 1; k += 1) {
        edgeKeys.add(memberPairKey(path[k], path[k + 1]));
      }
    }
  }

  return { nodeIds, edgeKeys, missingPairs };
}
