export type IdentityLinkStatus =
  "proposed" | "verified" | "rejected" | "expired" | "revoked";

export type IdentityLinkVerificationBasis =
  "mutual_consent" | "same_owner" | "legacy_dual_write_access";

export interface IdentityLinkEndpoint {
  workspace_id: string;
  workspace_name: string;
  member_id: string;
  display_name: string | null;
}

/** A verified or in-progress cross-workspace identity link, rendered from
 *  the viewer's own member's side (see `self`/`counterpart`). */
export interface IdentityLink {
  id: string;
  status: IdentityLinkStatus;
  verification_basis: IdentityLinkVerificationBasis;
  self: IdentityLinkEndpoint;
  /** Null when the viewer currently lacks read access to the counterpart —
   *  render `counterpart_protected` as a placeholder instead. */
  counterpart: IdentityLinkEndpoint | null;
  counterpart_protected: boolean;
  proposed_at: string;
  expires_at: string | null;
  verified_at: string | null;
  decided_at: string | null;
  decision_reason: string | null;
}

export type IdentityLinkClaimStatus =
  "pending" | "completed" | "declined" | "cancelled" | "expired";

/** The opaque claim/invitation half of the proposal flow: the proposer names
 *  only their own member and a friend, who later picks their own member. */
export interface IdentityLinkClaim {
  id: string;
  status: IdentityLinkClaimStatus;
  source_workspace_id: string;
  source_workspace_name: string;
  source_member_id: string;
  source_display_name: string | null;
  proposer_username: string | null;
  target_username: string;
  note: string | null;
  created_at: string;
  expires_at: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  resulting_identity_link_id: string | null;
}
