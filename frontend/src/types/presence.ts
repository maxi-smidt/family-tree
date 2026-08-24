/** Live-collaboration presence shapes (mirrors backend `schemas/presence.py`). */

export interface PresenceUserDB {
  user_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  editing_member_id: string | null;
}

export interface PresenceRosterDB {
  workspace_id: string;
  users: PresenceUserDB[];
}

export interface PresenceUser {
  userId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  /** Member whose sheet this user currently has open in edit mode, if any. */
  editingMemberId: string | null;
}

export const mapPresenceUser = (row: PresenceUserDB): PresenceUser => ({
  userId: row.user_id,
  displayName: row.display_name,
  firstName: row.first_name,
  lastName: row.last_name,
  editingMemberId: row.editing_member_id,
});
