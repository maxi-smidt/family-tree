/**
 * A server-side family **tree**. (The UI still presents these to users as
 * "databases", but in code they are workspaces, matching the backend.)
 */
export interface Workspace {
  id: string;
  name: string;
  owner_id?: string;
  created_at?: string;
  last_opened?: string | null;
  // Access level of the current user: "owner" | "editor" | "viewer".
  role?: "owner" | "editor" | "viewer";
  // Number of other users this tree is shared with (owner-relevant).
  shared_count?: number;
  // null = private; "viewer" = public read-only.
  public_role?: "viewer" | null;
  // True when the public tree requires a password (the hash is never sent).
  public_password_protected?: boolean;
  // Domains the current user may not see. Empty for owner/admin.
  restrictions?: string[];
}

export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  email: string | null;
  role: ShareRole;
  created_at: string;
  expires_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  token: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
}

export interface InvitationPreview {
  workspace_name: string;
  role: ShareRole;
  valid: boolean;
  requires_account: boolean;
}

export interface InvitationAcceptResult {
  workspace_id: string;
  workspace_name: string;
  role: ShareRole;
}

export type ShareRole = "viewer" | "editor";

export type RestrictableDomain =
  | "tree"
  | "gallery"
  | "events"
  | "map"
  | "stories"
  | "sources"
  | "diseases"
  | "biography"
  | "tasks";

export const RESTRICTABLE_DOMAINS: RestrictableDomain[] = [
  "tree",
  "gallery",
  "events",
  "map",
  "stories",
  "sources",
  "diseases",
  "biography",
  "tasks",
];

export interface WorkspaceAccess {
  user_id: string;
  username: string;
  role: "owner" | "editor" | "viewer";
  restrictions: string[];
}

/** A user a tree can still be shared with (returned by the candidates endpoint). */
export interface ShareCandidate {
  user_id: string;
  username: string;
}

export interface WorkspaceTransferResult {
  access: WorkspaceAccess[];
  undo_available_until: string | null;
}
