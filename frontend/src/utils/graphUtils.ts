import { Member } from "@/types/member";
import {
  COUPLE_RELATION_TYPES,
  STEP_PARENT_RELATION_TYPE,
  STEP_SIBLING_RELATION_TYPE,
} from "@/utils/relationKinds";

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
  // --- Tier 2: partner-derived, in-law, and step relations ---
  | { kind: "partner"; relationType: string }
  | { kind: "parent-in-law" | "child-in-law" | "sibling-in-law" }
  | { kind: "step-parent" | "step-child" | "step-sibling" }
  // --- Tier 3: graceful fallback for connected-but-unlabeled pairs ---
  | { kind: "relative"; distant: boolean }
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

// ---------------------------------------------------------------------------
// Tier 2: relation-based (partner / in-law / step) classification helpers
// ---------------------------------------------------------------------------

/**
 * Preference order for partner relationType when a pair has multiple relations.
 * Lower index = higher priority.
 */
const COUPLE_PRIORITY: Record<string, number> = {
  married: 0,
  partner: 1,
  divorced: 2,
};

interface PartnerInfo {
  /** Best (highest-priority) relationType for this pair. */
  relationType: string;
}

interface RelationAdjacency {
  /** id → Map<partnerId, PartnerInfo> */
  partnersOf: Map<string, Map<string, PartnerInfo>>;
  /** Set of "childId|stepParentId" explicit step-parent edges (undirected by pair key). */
  stepParentPairs: Set<string>;
  /** Set of memberPairKey(a, b) explicit step-sibling edges. */
  stepSiblingPairs: Set<string>;
}

/**
 * Scan all members' `relations` arrays and build adjacency sets for couple,
 * step-parent, and step-sibling edges. O(n) over all relation entries.
 */
function buildRelationAdjacency(members: Member[]): RelationAdjacency {
  const partnersOf = new Map<string, Map<string, PartnerInfo>>();
  const stepParentPairs = new Set<string>();
  const stepSiblingPairs = new Set<string>();

  const ensurePartnerMap = (id: string) => {
    if (!partnersOf.has(id)) partnersOf.set(id, new Map());
    return partnersOf.get(id)!;
  };

  const addCouple = (a: string, b: string, relationType: string) => {
    const priority = COUPLE_PRIORITY[relationType] ?? 99;

    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as [string, string][]) {
      const map = ensurePartnerMap(self);
      const existing = map.get(other);
      if (
        !existing ||
        (COUPLE_PRIORITY[existing.relationType] ?? 99) > priority
      ) {
        map.set(other, { relationType });
      }
    }
  };

  for (const m of members) {
    for (const rel of m.relations ?? []) {
      const { fromMemberId: from, toMemberId: to, relationType } = rel;
      if (COUPLE_RELATION_TYPES.has(relationType)) {
        addCouple(from, to, relationType);
      } else if (relationType === STEP_PARENT_RELATION_TYPE) {
        // Store as an undirected pair key; disambiguation happens in classify.
        stepParentPairs.add(memberPairKey(from, to));
      } else if (relationType === STEP_SIBLING_RELATION_TYPE) {
        stepSiblingPairs.add(memberPairKey(from, to));
      }
    }
  }

  return { partnersOf, stepParentPairs, stepSiblingPairs };
}

/**
 * Classify the relationship of `fromId` relative to `toId`, including
 * partner-derived, in-law, and step relations (Tier 2).
 *
 * Blood relations (from classifyKinship) always take precedence.
 * Returns `{kind:"none"}` when no relation of any kind is found.
 *
 * Priority order (first match wins):
 *   1. Blood (classifyKinship)
 *   2. partner
 *   3. parent-in-law
 *   4. child-in-law
 *   5. sibling-in-law
 *   6. step-parent
 *   7. step-child
 *   8. step-sibling
 */
export function classifyRelationship(
  members: Member[],
  fromId: string,
  toId: string,
): KinshipRelation {
  // --- Step 1: blood always wins ---
  const blood = classifyKinship(members, fromId, toId);
  if (blood.kind !== "none") return blood;

  const adj = buildRelationAdjacency(members);
  const { partnersOf, stepParentPairs, stepSiblingPairs } = adj;

  const fromPartners = partnersOf.get(fromId) ?? new Map<string, PartnerInfo>();
  const toPartners = partnersOf.get(toId) ?? new Map<string, PartnerInfo>();

  // --- Step 2: direct partner ---
  const partnerInfo = fromPartners.get(toId);
  if (partnerInfo) {
    return { kind: "partner", relationType: partnerInfo.relationType };
  }

  // --- Step 3: parent-in-law (from is a parent of to's partner) ---
  for (const [partnerId] of toPartners) {
    if (classifyKinship(members, fromId, partnerId).kind === "parent") {
      return { kind: "parent-in-law" };
    }
  }

  // --- Step 4: child-in-law (from's partner is a child of to) ---
  for (const [partnerId] of fromPartners) {
    if (classifyKinship(members, partnerId, toId).kind === "child") {
      return { kind: "child-in-law" };
    }
  }

  // --- Step 5: sibling-in-law ---
  // 5a: from is a sibling (or half-sibling) of to's partner
  for (const [partnerId] of toPartners) {
    const k = classifyKinship(members, fromId, partnerId).kind;
    if (k === "sibling" || k === "half-sibling") {
      return { kind: "sibling-in-law" };
    }
  }
  // 5b: from is the partner of a sibling (or half-sibling) of to
  for (const [partnerId] of fromPartners) {
    const k = classifyKinship(members, partnerId, toId).kind;
    if (k === "sibling" || k === "half-sibling") {
      return { kind: "sibling-in-law" };
    }
  }

  // --- Step 6: step-parent ---
  // Derived: from is the partner of a blood-parent of to
  const memberMap = new Map<string, Member>(members.map((m) => [m.id, m]));
  const toMember = memberMap.get(toId);
  if (toMember) {
    const toBloodParents = [
      toMember.parents.paternalParent,
      toMember.parents.maternalParent,
    ].filter((p): p is string => !!p);
    for (const parentId of toBloodParents) {
      const parentPartners = partnersOf.get(parentId) ?? new Map();
      if (parentPartners.has(fromId)) {
        return { kind: "step-parent" };
      }
    }
  }
  // Explicit step-parent relation (either direction)
  if (stepParentPairs.has(memberPairKey(fromId, toId))) {
    // Which one is the step-parent? The one who is NOT a blood-parent of the other.
    // classifyKinship already excluded blood, so if the pair exists at all and
    // blood was none, treat from as step-parent (direction: from→to).
    return { kind: "step-parent" };
  }

  // --- Step 7: step-child ---
  // Derived: to is the partner of a blood-parent of from
  const fromMember = memberMap.get(fromId);
  if (fromMember) {
    const fromBloodParents = [
      fromMember.parents.paternalParent,
      fromMember.parents.maternalParent,
    ].filter((p): p is string => !!p);
    for (const parentId of fromBloodParents) {
      const parentPartners = partnersOf.get(parentId) ?? new Map();
      if (parentPartners.has(toId)) {
        return { kind: "step-child" };
      }
    }
  }

  // --- Step 8: step-sibling ---
  // Explicit
  if (stepSiblingPairs.has(memberPairKey(fromId, toId))) {
    return { kind: "step-sibling" };
  }
  // Derived: from and to share a step-parent bond via their respective blood
  // parents being partners (and they are NOT blood siblings — already checked above).
  if (fromMember && toMember) {
    const fromBloodParents = new Set(
      [
        fromMember.parents.paternalParent,
        fromMember.parents.maternalParent,
      ].filter((p): p is string => !!p),
    );
    const toBloodParents = [
      toMember.parents.paternalParent,
      toMember.parents.maternalParent,
    ].filter((p): p is string => !!p);

    for (const pFrom of fromBloodParents) {
      const pFromPartners = partnersOf.get(pFrom) ?? new Map();
      for (const pTo of toBloodParents) {
        if (pFrom !== pTo && pFromPartners.has(pTo)) {
          return { kind: "step-sibling" };
        }
      }
    }
  }

  return { kind: "none" };
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
