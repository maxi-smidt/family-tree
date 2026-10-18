import { GRID_SIZE, NODE_HEIGHT, NODE_WIDTH } from "@/constants";

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

/** Diameter of a background dot, in flow units (React Flow's `size`). */
export const GRID_DOT_SIZE = 1.4;

/**
 * Offset for React Flow's dot <Background> so each dot marks where a card's
 * center can land. Cards snap by their top-left corner, so their centers sit
 * at NODE_WIDTH / 2, NODE_HEIGHT / 2 past a grid point. Generation lines and
 * the vertical connectors run through card centers, so they now sit on the
 * dot rows and columns. React Flow draws a dot at
 * `k * gap - gap / 2 - offset + size / 2`; solving for a dot at the card
 * center gives the offset below. It is wrapped into [0, gap) because React
 * Flow writes `translate(-${offset + gap / 2})`, and a negative value there
 * becomes an invalid `--` transform that the browser ignores.
 */
export function getGridDotOffset(
  gap: number = GRID_SIZE,
  dotSize: number = GRID_DOT_SIZE,
): [number, number] {
  const offsetFor = (phase: number) =>
    (((dotSize / 2 - gap / 2 - phase) % gap) + gap) % gap;
  return [offsetFor(NODE_WIDTH / 2), offsetFor(NODE_HEIGHT / 2)];
}
