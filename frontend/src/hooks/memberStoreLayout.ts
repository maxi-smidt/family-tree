import { Member } from "@/types/member";

export type CollapseUpdate = { id: string; isCollapsed: boolean };
export type PositionUpdate = { id: string; x: number; y: number };

/** Pure bulk-layout transforms used by the member mutation store. */
export function applyCollapsedState(
  members: Member[],
  updates: CollapseUpdate[],
): Member[] {
  const byId = new Map(updates.map((update) => [update.id, update.isCollapsed]));
  return members.map((member) => {
    const collapsed = byId.get(member.id);
    return collapsed === undefined ? member : { ...member, isCollapsed: collapsed };
  });
}

export function applyPositionState(
  members: Member[],
  positions: PositionUpdate[],
): Member[] {
  const byId = new Map(positions.map((position) => [position.id, position]));
  return members.map((member) => {
    const position = byId.get(member.id);
    return position ? { ...member, position: { x: position.x, y: position.y } } : member;
  });
}

export function captureCollapsedState(
  members: Member[],
  updates: CollapseUpdate[],
): CollapseUpdate[] {
  return updates.flatMap((update) => {
    const existing = members.find((member) => member.id === update.id);
    return existing ? [{ id: update.id, isCollapsed: existing.isCollapsed }] : [];
  });
}

export function capturePositions(
  members: Member[],
  positions: PositionUpdate[],
): PositionUpdate[] {
  return positions.flatMap((position) => {
    const existing = members.find((member) => member.id === position.id);
    return existing
      ? [{ id: position.id, x: existing.position.x, y: existing.position.y }]
      : [];
  });
}
