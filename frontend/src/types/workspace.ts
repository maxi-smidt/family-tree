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
  // Areas the current user may not see. Empty for owner/admin.
  restrictions?: string[];
  // Areas the current editor may see but not change (#1101).
  read_only?: string[];
  can_create_sections?: boolean;
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

/** The areas a share sets a level for (#1101), in display order. "tree"
 *  (people, relationships, sections) can be read-only but never hidden. */
export type ShareArea =
  | "tree"
  | "gallery"
  | "sources"
  | "stories"
  | "events"
  | "diseases"
  | "tasks";

export const SHARE_AREAS: ShareArea[] = [
  "tree",
  "gallery",
  "sources",
  "stories",
  "events",
  "diseases",
  "tasks",
];

export type AccessLevel = "hidden" | "view" | "edit";

export type AccessLevels = Record<ShareArea, AccessLevel>;

export interface WorkspaceAccess {
  user_id: string;
  username: string;
  role: "owner" | "editor" | "viewer";
  restrictions: string[];
  /** Areas this editor grant may see but not change (#1101). */
  read_only: string[];
  /** Null for a workspace-wide grant; otherwise the one section this grant
   *  covers. A user can have several rows, one per grant. */
  section_id: string | null;
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
