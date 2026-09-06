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

/** Mirrors `SavedViewCreate` — `filters` is left to its backend default. */
export interface SavedViewCreateInput {
  name: string;
  focus_member_id?: string | null;
  section_ids?: string[];
  ancestor_depth?: number;
  descendant_depth?: number;
  include_partners?: boolean;
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
