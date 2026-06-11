import { Member } from "@/types/member";

/**
 * BFS over maternalParent / paternalParent links, starting from `memberId`.
 *
 * Returns the IDs of every ancestor whose `isCollapsed` flag is `true`.
 * Handles cycles via a visited set and silently skips missing parents.
 *
 * Mirrors the `revealMemberAncestors` walk in FlowPanel.
 */
export function collectCollapsedAncestorIds(
  members: Member[],
  memberId: string,
): string[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const visited = new Set<string>();
  const queue = [memberId];
  const collapsedIds: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const member = byId.get(id);
    if (!member) continue;

    for (const parentId of [
      member.parents.maternalParent,
      member.parents.paternalParent,
    ]) {
      if (!parentId) continue;
      const parent = byId.get(parentId);
      if (parent?.isCollapsed) {
        collapsedIds.push(parentId);
      }
      queue.push(parentId);
    }
  }

  return collapsedIds;
}
