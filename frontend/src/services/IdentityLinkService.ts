import { api } from "@/services/api";
import { IdentityLink, IdentityLinkClaim } from "@/types/identityLink";

/** Thin HTTP client for identity links and claims (#1014). Stores call
 *  these; components don't. */
export const IdentityLinkService = {
  listForMember(
    workspaceId: string,
    memberId: string,
  ): Promise<IdentityLink[]> {
    return api
      .get<{
        links: IdentityLink[];
      }>(`/workspaces/${workspaceId}/members/${memberId}/identity-links`)
      .then((r) => r.links);
  },

  propose(
    workspaceId: string,
    memberId: string,
    targetWorkspaceId: string,
    targetMemberId: string,
  ): Promise<IdentityLink> {
    return api.post<IdentityLink>(
      `/workspaces/${workspaceId}/members/${memberId}/identity-links`,
      {
        target_workspace_id: targetWorkspaceId,
        target_member_id: targetMemberId,
      },
    );
  },

  /** Owner-only: every link touching this workspace, for review. */
  listForWorkspace(workspaceId: string): Promise<IdentityLink[]> {
    return api
      .get<{ links: IdentityLink[] }>(
        `/workspaces/${workspaceId}/identity-links`,
      )
      .then((r) => r.links);
  },

  approve(workspaceId: string, linkId: string): Promise<IdentityLink> {
    return api.post<IdentityLink>(
      `/workspaces/${workspaceId}/identity-links/${linkId}/approve`,
      {},
    );
  },

  reject(
    workspaceId: string,
    linkId: string,
    reason?: string,
    blockProposer = false,
  ): Promise<IdentityLink> {
    return api.post<IdentityLink>(
      `/workspaces/${workspaceId}/identity-links/${linkId}/reject`,
      { reason, block_proposer: blockProposer },
    );
  },

  revoke(
    workspaceId: string,
    linkId: string,
    reason?: string,
  ): Promise<IdentityLink> {
    return api.post<IdentityLink>(
      `/workspaces/${workspaceId}/identity-links/${linkId}/revoke`,
      { reason },
    );
  },

  // -- claims: the opaque flow for a target workspace the proposer can't read --

  proposeClaim(
    workspaceId: string,
    memberId: string,
    targetUsername: string,
    note?: string,
  ): Promise<IdentityLinkClaim> {
    return api.post<IdentityLinkClaim>(
      `/workspaces/${workspaceId}/members/${memberId}/identity-link-claims`,
      { target_username: targetUsername, note },
    );
  },

  listClaimsForMember(
    workspaceId: string,
    memberId: string,
  ): Promise<IdentityLinkClaim[]> {
    return api
      .get<{
        claims: IdentityLinkClaim[];
      }>(`/workspaces/${workspaceId}/members/${memberId}/identity-link-claims`)
      .then((r) => r.claims);
  },

  cancelClaim(
    workspaceId: string,
    claimId: string,
  ): Promise<IdentityLinkClaim> {
    return api.post<IdentityLinkClaim>(
      `/workspaces/${workspaceId}/identity-link-claims/${claimId}/cancel`,
      {},
    );
  },

  listIncomingClaims(): Promise<IdentityLinkClaim[]> {
    return api
      .get<{ claims: IdentityLinkClaim[] }>("/identity-link-claims/incoming")
      .then((r) => r.claims);
  },

  listOutgoingClaims(): Promise<IdentityLinkClaim[]> {
    return api
      .get<{ claims: IdentityLinkClaim[] }>("/identity-link-claims/outgoing")
      .then((r) => r.claims);
  },

  declineClaim(claimId: string, reason?: string): Promise<IdentityLinkClaim> {
    return api.post<IdentityLinkClaim>(
      `/identity-link-claims/${claimId}/decline`,
      { reason },
    );
  },

  completeClaim(
    claimId: string,
    workspaceId: string,
    memberId: string,
  ): Promise<IdentityLink> {
    return api.post<IdentityLink>(`/identity-link-claims/${claimId}/complete`, {
      workspace_id: workspaceId,
      member_id: memberId,
    });
  },
};
