/**
 * A "Database" in the UI is now a server-side family **tree**. The name is kept
 * for backwards compatibility with the existing components.
 */
export interface Database {
  id: string;
  name: string;
  owner_id?: string;
  created_at?: string;
  last_opened?: string | null;
  // Access level of the current user: "owner" | "editor" | "viewer".
  role?: "owner" | "editor" | "viewer";
}

export type Tree = Database;

export interface TreeAccess {
  user_id: string;
  username: string;
  role: "owner" | "editor" | "viewer";
}
