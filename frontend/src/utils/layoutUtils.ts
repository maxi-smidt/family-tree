import { Member } from "@/types/member";
import dagre from "@dagrejs/dagre";
import { NODE_WIDTH, NODE_HEIGHT } from "@/constants";

const RANK_SEPARATION = 90;
const NODE_SEPARATION = 150;
const GRID_SIZE = 50;

export const getLayoutedElements = (members: Member[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
    edgesep: 20,
    ranker: "network-simplex",
    acyclicer: "greedy",
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Sort members by birth date, then gender (Male first), then ID.
  // Merged (vm_) nodes sort before regular nodes so that dagre's barycenter
  // heuristic places them to the left of their sibling group, adjacent to
  // their cross-tree partner rather than trailing at the far end.
  const sortedMembers = [...members].sort((a, b) => {
    const aIsVM = a.id.startsWith("vm_");
    const bIsVM = b.id.startsWith("vm_");
    if (aIsVM !== bIsVM) return aIsVM ? -1 : 1;

    // Prefer the pre-computed zero-padded sort key (YYYY-MM-DD) when available;
    // members without a sort key sort last (equivalent to the old "9999-12-31"
    // sentinel). Fall back to new Date(...) comparison only when both keys are
    // absent so un-backfilled data is handled gracefully.
    const aSortKey = a.date.birthSort || null;
    const bSortKey = b.date.birthSort || null;

    let dateCmp: number;
    if (aSortKey !== null && bSortKey !== null) {
      dateCmp = aSortKey < bSortKey ? -1 : aSortKey > bSortKey ? 1 : 0;
    } else if (aSortKey !== null) {
      // b has no sort key → b sorts last
      dateCmp = -1;
    } else if (bSortKey !== null) {
      // a has no sort key → a sorts last
      dateCmp = 1;
    } else {
      // Neither has a sort key — fall back to Date parsing for backward compat.
      const dateA = new Date(a.date.birth || "9999-12-31").getTime();
      const dateB = new Date(b.date.birth || "9999-12-31").getTime();
      dateCmp = dateA - dateB;
    }

    if (dateCmp !== 0) {
      return dateCmp;
    }

    if (a.gender !== b.gender) {
      return a.gender === "m" ? -1 : 1;
    }

    return a.id.localeCompare(b.id);
  });

  const memberIds = new Set(members.map((m) => m.id));

  sortedMembers.forEach((member) => {
    g.setNode(member.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  const unions = new Map<string, string>();

  // Helper to generate union key
  const getUnionKey = (ids: string[]) => ids.sort().join("-");

  // --- Sibling Grouping Logic ---
  // 1. Map explicit parents
  const memberParentKeys = new Map<string, string>();
  const memberParentIds = new Map<string, string[]>();

  members.forEach((member) => {
    const { maternalParent, paternalParent } = member.parents;
    const parentIds = [maternalParent, paternalParent].filter(
      (id): id is string => !!id,
    );
    if (parentIds.length > 0) {
      const key = getUnionKey(parentIds);
      memberParentKeys.set(member.id, key);
      memberParentIds.set(member.id, parentIds);
    }
  });

  // 2. Build adjacency list for siblings
  const siblingAdj = new Map<string, string[]>();

  members.forEach((member) => {
    if (member.relations) {
      member.relations.forEach((rel) => {
        if (rel.relationType === "sibling" && memberIds.has(rel.toMemberId)) {
          if (!siblingAdj.has(member.id)) siblingAdj.set(member.id, []);
          siblingAdj.get(member.id)?.push(rel.toMemberId);
        }
      });
    }
  });

  // 3. Find connected components of siblings and infer/virtualize parents
  const visited = new Set<string>();
  const memberEffectiveParentKey = new Map<string, string>();
  const memberEffectiveParentIds = new Map<string, string[]>();

  sortedMembers.forEach((member) => {
    if (visited.has(member.id)) return;

    const component: string[] = [];
    const queue = [member.id];
    visited.add(member.id);

    while (queue.length > 0) {
      const currId = queue.shift()!;
      component.push(currId);

      const neighbors = siblingAdj.get(currId) || [];
      neighbors.forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      });
    }

    const componentParentKeys = new Set<string>();
    component.forEach((id) => {
      if (memberParentKeys.has(id)) {
        componentParentKeys.add(memberParentKeys.get(id)!);
      }
    });

    if (componentParentKeys.size === 0) {
      if (component.length > 1) {
        const virtualKey = `virtual-parents-${getUnionKey(component)}`;
        component.forEach((id) => {
          memberEffectiveParentKey.set(id, virtualKey);
        });
      }
    } else if (componentParentKeys.size === 1) {
      const key = Array.from(componentParentKeys)[0];
      const memberWithParents = component.find(
        (id) => memberParentKeys.get(id) === key,
      );
      const pIds = memberParentIds.get(memberWithParents!);

      component.forEach((id) => {
        if (!memberParentKeys.has(id)) {
          memberEffectiveParentKey.set(id, key);
          memberEffectiveParentIds.set(id, pIds!);
        }
      });
    }
  });

  // --- Main Layout Loop (Children & Parents) ---
  sortedMembers.forEach((child) => {
    let unionKey = memberEffectiveParentKey.get(child.id);
    let parentIds = memberEffectiveParentIds.get(child.id);

    if (!unionKey) {
      const { maternalParent, paternalParent } = child.parents;
      const pIds = [maternalParent, paternalParent].filter(
        (id): id is string => !!id,
      );
      if (pIds.length > 0) {
        unionKey = getUnionKey(pIds);
        parentIds = pIds;
      }
    }

    if (unionKey) {
      let unionId = unions.get(unionKey);

      if (!unionId) {
        unionId = `union-${unionKey}`;
        unions.set(unionKey, unionId);

        g.setNode(unionId, {
          width: 1,
          height: 1,
        });

        if (parentIds) {
          parentIds.forEach((pId) => {
            if (typeof unionId === "string") {
              g.setEdge(pId, unionId, { weight: 10, minlen: 1 });
            }
          });
        }
      }

      // Increased weight to keep siblings closer together under the union
      g.setEdge(unionId, child.id, { weight: 10, minlen: 1 });
    }
  });

  // --- Partner Logic ---
  const processedPartners = new Set<string>();

  // Use sortedMembers to maintain consistent order
  sortedMembers.forEach((member) => {
    if (member.relations) {
      member.relations.forEach((rel) => {
        if (
          ["partner", "married", "divorced"].includes(rel.relationType) &&
          memberIds.has(rel.toMemberId)
        ) {
          const p1 = member.id;
          const p2 = rel.toMemberId;
          const pairKey = getUnionKey([p1, p2]);

          if (processedPartners.has(pairKey)) return;
          processedPartners.add(pairKey);

          let unionId = unions.get(pairKey);

          if (!unionId) {
            unionId = `union-${pairKey}`;
            unions.set(pairKey, unionId);

            g.setNode(unionId, {
              width: 1,
              height: 1,
            });
          }

          // Adjusted weights:
          // Divorced: 5 (weaker connection)
          // Married/Partner: 10 (strong, but balanced with sibling connection)
          const weight = rel.relationType === "divorced" ? 5 : 10;

          g.setEdge(p1, unionId!, { weight, minlen: 1 });
          g.setEdge(p2, unionId!, { weight, minlen: 1 });
        }
      });
    }
  });

  dagre.layout(g);

  const finalPositions: Record<string, { x: number; y: number }> = {};

  members.forEach((member) => {
    const node = g.node(member.id);
    if (node) {
      // Snap to grid
      const x = node.x - NODE_WIDTH / 2;
      const y = node.y - NODE_HEIGHT / 2;

      finalPositions[member.id] = {
        x: Math.round(x / GRID_SIZE) * GRID_SIZE,
        y: Math.round(y / GRID_SIZE) * GRID_SIZE,
      };
    }
  });

  // Post-process: order siblings so that a member married to someone OUTSIDE
  // the group sits on the side nearest that partner. Dagre orders same-parent
  // siblings by its barycenter heuristic, which routinely strands a married
  // sibling at the far end of the group so the partner connector crosses the
  // other siblings' cards (e.g. Marge ends up at the opposite end of her
  // Bouvier sibling group from Homer). This generalises the merged-node case:
  // the stranded partner may be the merged node, the merged node's spouse, or
  // any couple in a plain tree. Permuting members within their own group's
  // x-slots is always safe — siblings share parents and form a contiguous block.
  const PARTNER_RELATIONS = ["partner", "married", "divorced"];
  const partnerOf = new Map<string, string>();
  members.forEach((m) => {
    m.relations?.forEach((r) => {
      if (!PARTNER_RELATIONS.includes(r.relationType)) return;
      if (!memberIds.has(r.toMemberId)) return;
      if (!partnerOf.has(m.id)) partnerOf.set(m.id, r.toMemberId);
      if (!partnerOf.has(r.toMemberId)) partnerOf.set(r.toMemberId, m.id);
    });
  });

  // The sibling-group key a member was laid out under (explicit or inferred).
  const groupKeyOf = (id: string): string | null =>
    memberEffectiveParentKey.get(id) ?? memberParentKeys.get(id) ?? null;

  // Each member's horizontal "pull": the x of a partner living outside its
  // sibling group, else its own current x. Read from the pre-permutation
  // snapshot so a group's ordering never depends on iteration order.
  const anchorX = (m: Member): number => {
    const own = finalPositions[m.id]?.x ?? 0;
    const partnerId = partnerOf.get(m.id);
    if (!partnerId) return own;
    const myGroup = groupKeyOf(m.id);
    if (myGroup !== null && groupKeyOf(partnerId) === myGroup) return own;
    return finalPositions[partnerId]?.x ?? own;
  };

  // Bucket members into (sibling group, rank) cells, then permute each cell's
  // members across their own x-slots in anchor order.
  const siblingCells = new Map<string, Member[]>();
  members.forEach((m) => {
    const gk = groupKeyOf(m.id);
    const pos = finalPositions[m.id];
    if (!gk || !pos) return;
    const cell = `${gk}@${pos.y}`;
    if (!siblingCells.has(cell)) siblingCells.set(cell, []);
    siblingCells.get(cell)!.push(m);
  });

  siblingCells.forEach((group) => {
    if (group.length < 2) return;
    const slots = group
      .map((m) => finalPositions[m.id].x)
      .sort((a, b) => a - b);
    const anchors = new Map(group.map((m) => [m.id, anchorX(m)]));
    const ordered = [...group].sort((a, b) => {
      const delta = anchors.get(a.id)! - anchors.get(b.id)!;
      if (delta !== 0) return delta;
      return finalPositions[a.id].x - finalPositions[b.id].x;
    });
    ordered.forEach((m, i) => {
      finalPositions[m.id] = { ...finalPositions[m.id], x: slots[i] };
    });
  });

  // Post-process: for each merged (vm_) node, re-center its parents horizontally
  // above ALL their children (not just the sibling cluster dagre places them over).
  // This prevents situations where parents stay far to one side because dagre only
  // "sees" the unmerged siblings when computing their horizontal position.
  const parentXOverride = new Map<string, number>();

  // Precompute a lookup map from (paternalParent, maternalParent) pair →
  // children, so the vm_ loop below is O(n) overall instead of O(n²).
  const childrenByParentPair = new Map<string, Member[]>();
  members.forEach((s) => {
    const { paternalParent, maternalParent } = s.parents;
    if (!paternalParent || !maternalParent) return;
    const pairKey = `${paternalParent} ${maternalParent}`;
    if (!childrenByParentPair.has(pairKey))
      childrenByParentPair.set(pairKey, []);
    childrenByParentPair.get(pairKey)!.push(s);
  });

  members.forEach((m) => {
    if (!m.id.startsWith("vm_")) return;
    const { paternalParent, maternalParent } = m.parents;
    if (!paternalParent || !maternalParent) return;
    if (!memberIds.has(paternalParent) || !memberIds.has(maternalParent))
      return;

    // All members that share exactly these two parents.
    const sharedChildren =
      childrenByParentPair.get(`${paternalParent} ${maternalParent}`) ?? [];
    if (sharedChildren.length < 2) return;

    const xs = sharedChildren
      .map((s) => finalPositions[s.id]?.x)
      .filter((x): x is number => x !== undefined);
    if (xs.length === 0) return;

    const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const halfGap = (NODE_WIDTH + NODE_SEPARATION) / 2;

    parentXOverride.set(paternalParent, avgX - halfGap);
    parentXOverride.set(maternalParent, avgX + halfGap);
  });

  parentXOverride.forEach((x, id) => {
    if (finalPositions[id]) {
      finalPositions[id] = {
        ...finalPositions[id],
        x: Math.round(x / GRID_SIZE) * GRID_SIZE,
      };
    }
  });

  return finalPositions;
};
