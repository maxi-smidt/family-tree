/**
 * A server-side family **tree**. (The UI still presents these to users as
 * "databases", but in code they are trees, matching the backend.)
 */
export interface VirtualViewSource {
  // The source id — a real tree id, or a `vv_` view id when `kind === "view"`.
  tree_id: string;
  tree_name: string;
  accessible: boolean;
  kind?: "tree" | "view";
  is_virtual?: boolean;
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
  // Domains the current user may not see. Empty for owner/admin.
  restrictions?: string[];
  // Set on virtual views returned by /virtual-views.
  is_virtual?: boolean;
  sources?: VirtualViewSource[];
}

/** Sub-tree extraction always relocates the branch into a new tree, linked
 * through the root member (the bridge person), which stays behind in the
 * source tree. "whole_family" (default) pulls in everyone attached to the
 * root who isn't part of the root's own family; "descendants"/"ancestors"
 * traverse parent-edges from the root (honouring depth/include_partners). */
export type SubtreeExtractDirection = "whole_family" | "descendants" | "ancestors";

export interface SubtreeExtractPayload {
  name: string;
  source_tree_id: string;
  root_member_id: string;
  direction: SubtreeExtractDirection;
  depth: number | null;
  include_partners: boolean;
}

/** Mirrors the backend `SubtreePreview` schema. */
export interface SubtreeExtractPreview {
  member_count: number;
  relation_count: number;
  severed_relation_count: number;
  media_bytes: number;
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

export type RestrictableDomain =
  | "tree"
  | "gallery"
  | "events"
  | "map"
  | "stories"
  | "sources"
  | "diseases"
  | "biography";

export const RESTRICTABLE_DOMAINS: RestrictableDomain[] = [
  "tree",
  "gallery",
  "events",
  "map",
  "stories",
  "sources",
  "diseases",
  "biography",
];

export interface TreeAccess {
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

export interface TreeTransferResult {
  access: TreeAccess[];
  undo_available_until: string | null;
}
