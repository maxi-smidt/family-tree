import { Member } from "@/types/member";
import dagre from "@dagrejs/dagre";
import { NODE_WIDTH, NODE_HEIGHT } from "../../constants.json";

// Approximate height of the node card
const RANK_SEPARATION = 550;
const NODE_SEPARATION = 250;
const PIXELS_PER_YEAR = 10;
const BASE_Y = 100;

export const getLayoutedElements = (members: Member[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes to the graph
  members.forEach((member) => {
    g.setNode(member.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  // Add edges to the graph
  members.forEach((member) => {
    // Add paternal parent first (Left)
    if (member.parents.paternalParent) {
      g.setEdge(member.parents.paternalParent, member.id);
    }
    // Add maternal parent second (Right)
    if (member.parents.maternalParent) {
      g.setEdge(member.parents.maternalParent, member.id);
    }
  });

  dagre.layout(g);

  // Calculate Y position based on birth year if available
  // We'll use a map to store the calculated positions
  const positions = new Map<string, { x: number; y: number }>();

  // First pass: get dagre positions
  g.nodes().forEach((nodeId) => {
    const node = g.node(nodeId);
    positions.set(nodeId, {
      x: node.x - NODE_WIDTH / 2,
      y: node.y - NODE_HEIGHT / 2,
    });
  });

  // Second pass: adjust Y based on birth year
  // Find min and max years to normalize
  let minYear = Infinity;
  members.filter((m) => {
    const year = getYear(m.date.birth);
    if (year && year < minYear) minYear = year;
    return !!year;
  });
  // Let's refine the requirement: "position of the y axis should be date of birth dependent"
  // If we strictly follow this, we ignore dagre's Y.
  // But we need to handle cases with no date.

  const finalPositions: Record<string, { x: number; y: number }> = {};

  members.forEach((member) => {
    const pos = positions.get(member.id);
    if (!pos) return;

    let y = pos.y;
    const year = getYear(member.date.birth);

    if (year) {
      // If we have a valid year, use it.
      if (minYear !== Infinity) {
        y = BASE_Y + (year - minYear) * PIXELS_PER_YEAR;
      }
    } else {
      // If no date, maybe place relative to parents?
      // Or just keep dagre's topological sort which is usually "generation" based.
      // Dagre's rank separation is 100.
      // Let's map dagre rank to a "fake year" if needed, or just use the Y.
      // To make them compatible, we might need to scale dagre's Y to match the year scale.
    }

    finalPositions[member.id] = { x: pos.x, y };
  });

  return finalPositions;
};

function getYear(dateString: string): number | null {
  if (!dateString) return null;
  const match = dateString.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}
