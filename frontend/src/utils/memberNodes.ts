import { Node } from "@xyflow/react";
import { Member } from "@/types/member";

/**
 * Build the React Flow member nodes from the store's members, carrying over
 * what React Flow and the user own from the previous nodes: the selection and
 * the measured card size.
 *
 * Dropping `measured` makes React Flow treat every card as uninitialized: it
 * hides the cards, stops drawing their edges and waits for its ResizeObserver
 * to measure them again. When two rebuilds land close together that
 * re-measure can be missed, leaving the edges gone until a reload.
 */
export function buildMemberNodes(members: Member[], prevNodes: Node[]): Node[] {
  const prevById = new Map(prevNodes.map((n) => [n.id, n]));
  return members.map((member) => {
    const prev = prevById.get(member.id);
    return {
      id: member.id,
      type: "familyMember",
      position: member.position,
      data: member,
      selected: prev?.selected ?? false,
      ...(prev?.measured ? { measured: prev.measured } : {}),
    };
  });
}
