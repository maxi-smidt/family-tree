export interface Activity {
  id: string;
  treeId: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string; // "create" | "update" | "delete"
  targetType: string; // "member" | "relation" | "event" | "story" | "task" | "gallery_image" | "document" | "disease" | "tree" | "share" | "import" | "merge"
  targetId: string | null;
  targetLabel: string | null;
  createdAt: string;
  details?: Record<string, unknown> | null;
}

export interface ActivityDB {
  id: string;
  tree_id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  created_at: string;
  details?: string | null;
}

export interface ActivityPageDB {
  entries: ActivityDB[];
  total: number;
  actors: string[];
}

export function mapActivityFromDB(row: ActivityDB): Activity {
  let details: Record<string, unknown> | null = null;
  if (row.details) {
    try {
      details = JSON.parse(row.details) as Record<string, unknown>;
    } catch {
      details = null;
    }
  }
  return {
    id: row.id,
    treeId: row.tree_id,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetLabel: row.target_label,
    createdAt: row.created_at,
    details,
  };
}
