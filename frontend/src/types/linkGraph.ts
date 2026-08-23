/** A tree reachable from the start tree via member-to-tree links. */
export interface LinkGraphNodeDB {
  id: string;
  name: string | null;
  member_count: number | null;
  /** The requesting user's role on this tree, or null for placeholders. */
  role: string | null;
  accessible: boolean;
  is_current: boolean;
}

/** A bridge person backing one tree-to-tree link on an edge. */
export interface LinkGraphBridgeMemberDB {
  id: string;
  name: string | null;
}

/** One or more bridge-person links from a source tree to a target tree. */
export interface LinkGraphEdgeDB {
  source_workspace_id: string;
  target_workspace_id: string;
  count: number;
  bridge_members: LinkGraphBridgeMemberDB[];
}

/** Response shape for GET /workspaces/{id}/link-graph. */
export interface LinkGraphDB {
  nodes: LinkGraphNodeDB[];
  edges: LinkGraphEdgeDB[];
  truncated: boolean;
}
