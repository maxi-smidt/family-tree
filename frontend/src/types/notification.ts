/** A single row in the persistent per-user notification inbox. */
export interface NotificationDB {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

/** A bounded, newest-first page of notifications. */
export interface NotificationPage {
  entries: NotificationDB[];
  total: number;
  unread_count: number;
}
