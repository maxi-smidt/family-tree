/** A saved view (#986): a stored way of looking at the workspace. Listing and
 *  selection are owned by #988; creation/configuration/editing is #1013.
 *  Field names mirror the backend `SavedViewOut` schema, which is plain
 *  snake_case (not `FamilyTreeOrmBaseModel`) — see `schemas/saved_view.py`. */
export interface SavedViewPositionDB {
  node_id: string;
  position_x: number;
  position_y: number;
}

export interface SavedViewDB {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  focus_member_id: string | null;
  section_ids: string[];
  ancestor_depth: number;
  descendant_depth: number;
  include_partners: boolean;
  filters: Record<string, unknown>;
  config_version: number;
  version: number;
  created_at: string;
  updated_at: string;
  last_opened: string | null;
  positions: SavedViewPositionDB[];
}

/** Mirrors `SavedViewCreate` — `filters` defaults to `{}` on the backend when
 *  omitted. */
export interface SavedViewCreateInput {
  name: string;
  focus_member_id?: string | null;
  section_ids?: string[];
  ancestor_depth?: number;
  descendant_depth?: number;
  include_partners?: boolean;
  filters?: Record<string, unknown>;
}

/** Mirrors `SavedViewUpdate`: every field but `expected_version` is optional
 *  and, when given, replaces the prior value outright. */
export interface SavedViewUpdateInput {
  name?: string;
  focus_member_id?: string | null;
  clear_focus_member?: boolean;
  section_ids?: string[];
  ancestor_depth?: number;
  descendant_depth?: number;
  include_partners?: boolean;
  expected_version: number;
}

/** Depth meaning "all the way" up or down — mirrors the backend's
 *  `ALL_GENERATIONS` in `services/workspaces/neighborhood.py`. Stored
 *  literally in `ancestor_depth` / `descendant_depth`. */
export const ALL_GENERATIONS = 999;

/** The largest bounded depth a saved view may store. */
export const MAX_SAVED_VIEW_DEPTH = 20;

export const isAllGenerations = (depth: number) => depth >= ALL_GENERATIONS;

/** One generation more or fewer on the canvas, within `[1, max]`. "All the
 *  way" stays all the way when growing and drops to `max` when shrinking. */
export const stepNeighborhoodDepth = (
  depth: number,
  delta: 1 | -1,
  max: number,
) =>
  isAllGenerations(depth)
    ? delta > 0
      ? depth
      : max
    : Math.min(Math.max(depth + delta, 1), max);
