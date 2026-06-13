/**
 * A server-side family **tree**. (The UI still presents these to users as
 * "databases", but in code they are trees, matching the backend.)
 */
export interface VirtualViewSource {
  tree_id: string;
  tree_name: string;
  accessible: boolean;
}

export interface Tree {
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
  // Set on virtual views returned by /virtual-views.
  is_virtual?: boolean;
  sources?: VirtualViewSource[];
}

export interface TreeInvitation {
  id: string;
  tree_id: string;
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
  tree_name: string;
  role: ShareRole;
  valid: boolean;
  requires_account: boolean;
}

export interface InvitationAcceptResult {
  tree_id: string;
  tree_name: string;
  role: ShareRole;
}

export type ShareRole = "viewer" | "editor";

export interface TreeAccess {
  user_id: string;
  username: string;
  role: "owner" | "editor" | "viewer";
}

/** A user a tree can still be shared with (returned by the candidates endpoint). */
export interface ShareCandidate {
  user_id: string;
  username: string;
}
