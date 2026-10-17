export interface Activity {
  id: string;
  workspaceId: string;
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
  workspace_id: string;
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

export interface UndoSkippedItem {
  table: string;
  reason: string;
  id?: string | null;
}

export interface ActivityUndoDB {
  undo_entry_id: string;
  target_type: string;
  restored: Record<string, unknown>;
  skipped: UndoSkippedItem[];
}

/** True for a delete entry whose details carry a snapshot this backend
 * version knows how to restore — the only entries eligible for undo. */
export function isUndoableDelete(activity: Activity): boolean {
  if (activity.action !== "delete" || !activity.details) return false;
  const snapshot = activity.details.snapshot as { version?: number } | undefined;
  return !!snapshot && snapshot.version === 1;
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
    workspaceId: row.workspace_id,
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
