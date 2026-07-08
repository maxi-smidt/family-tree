import { RelationType } from "@/types/member";

export type PendingRelation =
  | { type: "child-of"; parentId: string }
  | { type: "parent-of"; childId: string }
  | { type: "related"; sourceId: string; relationType: RelationType }
  | { type: "child-of-union"; parent1Id: string; parent2Id: string };

export type MemberPlacement = "child" | "parent" | "left" | "right";

/**
 * Compute the initial position for a new member relative to an anchor node.
 *
 * Offsets match the originals in FlowPanel:
 *   child  → y + 200
 *   parent → y - 200
 *   left   → x - 300
 *   right  → x + 300
 */
export function nextMemberPosition(
  anchor: { x: number; y: number },
  placement: MemberPlacement,
): { x: number; y: number } {
  switch (placement) {
    case "child":
      return { x: anchor.x, y: anchor.y + 200 };
    case "parent":
      return { x: anchor.x, y: anchor.y - 200 };
    case "left":
      return { x: anchor.x - 300, y: anchor.y };
    case "right":
      return { x: anchor.x + 300, y: anchor.y };
  }
}
