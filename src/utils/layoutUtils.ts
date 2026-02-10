import { Member } from "@/types/member";
import dagre from "@dagrejs/dagre";
import { NODE_WIDTH, NODE_HEIGHT } from "../../constants.json";

const RANK_SEPARATION = 120;
const NODE_SEPARATION = 100;

export const getLayoutedElements = (members: Member[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "BT",
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
  });
  g.setDefaultEdgeLabel(() => ({}));

  members.forEach((member) => {
    g.setNode(member.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  const unions = new Map<string, string>();

  members.forEach((child) => {
    const { maternalParent, paternalParent } = child.parents;

    if (maternalParent && paternalParent) {
      const unionKey = `${maternalParent}-${paternalParent}`;
      let unionId = unions.get(unionKey);

      if (!unionId) {
        unionId = `union-${unionKey}`;
        unions.set(unionKey, unionId);

        g.setNode(unionId, {
          width: 0,
          height: 0,
        });

        g.setEdge(unionId, maternalParent);
        g.setEdge(unionId, paternalParent);
      }

      g.setEdge(child.id, unionId);
    } else if (maternalParent) {
      g.setEdge(child.id, maternalParent);
    } else if (paternalParent) {
      g.setEdge(child.id, paternalParent);
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
