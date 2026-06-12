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

    const dateA = new Date(a.date.birth || "9999-12-31").getTime();
    const dateB = new Date(b.date.birth || "9999-12-31").getTime();

    if (dateA !== dateB) {
      return dateA - dateB;
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
      // Merged bridge nodes (vm_) that have a cross-tree partner should not
      // share a union node with their siblings. Giving them their own union
      // lets the partner edge dominate horizontal positioning, so dagre places
      // them between the two family groups instead of inside the sibling cluster.
      const isBridgeNode =
        child.id.startsWith("vm_") &&
        child.relations?.some(
          (r) =>
            ["partner", "married", "divorced"].includes(r.relationType) &&
            memberIds.has(r.toMemberId),
        );
      const effectiveUnionKey = isBridgeNode
        ? `${unionKey}-${child.id}`
        : unionKey;

      let unionId = unions.get(effectiveUnionKey);

      if (!unionId) {
        unionId = `union-${effectiveUnionKey}`;
        unions.set(effectiveUnionKey, unionId);

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

  return finalPositions;
};
