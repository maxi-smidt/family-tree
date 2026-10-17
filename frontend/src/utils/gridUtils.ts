import { GRID_SIZE } from "@/constants";

/** The canvas snap grid, shared by React Flow, the dot background and layout. */
export const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];

/**
 * Round a flow position onto the snap grid. React Flow only snaps while a node
 * is dragged, so any position set in code (a new member, a stored position)
 * must land on the same lattice or dragged cards can never line up with it.
 */
export function snapToGrid(position: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
  };
}
