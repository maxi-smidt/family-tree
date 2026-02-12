import { Member } from "@/types/member";
import dagre from "@dagrejs/dagre";
import { NODE_WIDTH, NODE_HEIGHT } from "@/constants";

const RANK_SEPARATION = 90;
const NODE_SEPARATION = 150;

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

  const sortedMembers = [...members].sort((a, b) => {
    const dateA = new Date(a.date.birth || "9999-12-31").getTime();
    const dateB = new Date(b.date.birth || "9999-12-31").getTime();

    if (dateA === dateB) {
      return a.id.localeCompare(b.id);
    }
    return dateA - dateB;
  });

  sortedMembers.forEach((member) => {
    g.setNode(member.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  const unions = new Map<string, string>();

  sortedMembers.forEach((child) => {
    const { maternalParent, paternalParent } = child.parents;

    if (maternalParent || paternalParent) {
      const parentIds = [maternalParent, paternalParent].filter(
        (id): id is string => !!id,
      );
      const unionKey = parentIds.sort().join("-");

      let unionId = unions.get(unionKey);

      if (!unionId) {
        unionId = `union-${unionKey}`;
        unions.set(unionKey, unionId);

        g.setNode(unionId, {
          width: 10,
          height: 10,
        });

        parentIds.forEach((pId) => {
          if (typeof unionId === "string") {
            g.setEdge(pId, unionId, { weight: 10, minlen: 1 });
          }
        });
      }

      g.setEdge(unionId, child.id, { weight: 1, minlen: 1 });
    }
  });

  dagre.layout(g);

  const finalPositions: Record<string, { x: number; y: number }> = {};

  members.forEach((member) => {
    const node = g.node(member.id);
    if (node) {
      finalPositions[member.id] = {
        x: node.x - NODE_WIDTH / 2,
        y: node.y - NODE_HEIGHT / 2,
      };
    }
  });

  return finalPositions;
};
