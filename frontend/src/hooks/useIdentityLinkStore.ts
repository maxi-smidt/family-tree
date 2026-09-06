import { create } from "zustand";
import { IdentityLinkService } from "@/services/IdentityLinkService";
import { IdentityLink, IdentityLinkClaim } from "@/types/identityLink";

interface IdentityLinkState {
  linksByMember: Record<string, IdentityLink[]>;
  claimsByMember: Record<string, IdentityLinkClaim[]>;
  workspaceLinks: IdentityLink[];
  incomingClaims: IdentityLinkClaim[];
  outgoingClaims: IdentityLinkClaim[];

  loadForMember: (workspaceId: string, memberId: string) => Promise<void>;
  propose: (
    workspaceId: string,
    memberId: string,
    targetWorkspaceId: string,
    targetMemberId: string,
  ) => Promise<void>;
  approve: (
    workspaceId: string,
    memberId: string,
    linkId: string,
  ) => Promise<void>;
  reject: (
    workspaceId: string,
    memberId: string,
    linkId: string,
    reason?: string,
    blockProposer?: boolean,
  ) => Promise<void>;
  revoke: (
    workspaceId: string,
    memberId: string,
    linkId: string,
    reason?: string,
  ) => Promise<void>;
  proposeClaim: (
    workspaceId: string,
    memberId: string,
    targetUsername: string,
    note?: string,
  ) => Promise<void>;
  cancelClaim: (
    workspaceId: string,
    memberId: string,
    claimId: string,
  ) => Promise<void>;

  loadWorkspaceLinks: (workspaceId: string) => Promise<void>;
  approveWorkspaceLink: (workspaceId: string, linkId: string) => Promise<void>;
  rejectWorkspaceLink: (
    workspaceId: string,
    linkId: string,
    reason?: string,
  ) => Promise<void>;
  revokeWorkspaceLink: (
    workspaceId: string,
    linkId: string,
    reason?: string,
  ) => Promise<void>;

  loadClaimInbox: () => Promise<void>;
  declineClaim: (claimId: string, reason?: string) => Promise<void>;
  completeClaim: (
    claimId: string,
    workspaceId: string,
    memberId: string,
  ) => Promise<void>;
  cancelOutgoingClaim: (claimId: string) => Promise<void>;

  clearWorkspaceScoped: () => void;
  clear: () => void;
}

export const useIdentityLinkStore = create<IdentityLinkState>((set, get) => ({
  linksByMember: {},
  claimsByMember: {},
  workspaceLinks: [],
  incomingClaims: [],
  outgoingClaims: [],

  loadForMember: async (workspaceId, memberId) => {
    const [links, claims] = await Promise.all([
      IdentityLinkService.listForMember(workspaceId, memberId),
      IdentityLinkService.listClaimsForMember(workspaceId, memberId),
    ]);
    set((s) => ({
      linksByMember: { ...s.linksByMember, [memberId]: links },
      claimsByMember: { ...s.claimsByMember, [memberId]: claims },
    }));
  },

  propose: async (workspaceId, memberId, targetWorkspaceId, targetMemberId) => {
    await IdentityLinkService.propose(
      workspaceId,
      memberId,
      targetWorkspaceId,
      targetMemberId,
    );
    await get().loadForMember(workspaceId, memberId);
  },

  approve: async (workspaceId, memberId, linkId) => {
    await IdentityLinkService.approve(workspaceId, linkId);
    await get().loadForMember(workspaceId, memberId);
  },

  reject: async (workspaceId, memberId, linkId, reason, blockProposer) => {
    await IdentityLinkService.reject(
      workspaceId,
      linkId,
      reason,
      blockProposer,
    );
    await get().loadForMember(workspaceId, memberId);
  },

  revoke: async (workspaceId, memberId, linkId, reason) => {
    await IdentityLinkService.revoke(workspaceId, linkId, reason);
    await get().loadForMember(workspaceId, memberId);
  },

  proposeClaim: async (workspaceId, memberId, targetUsername, note) => {
    await IdentityLinkService.proposeClaim(
      workspaceId,
      memberId,
      targetUsername,
      note,
    );
    await get().loadForMember(workspaceId, memberId);
  },

  cancelClaim: async (workspaceId, memberId, claimId) => {
    await IdentityLinkService.cancelClaim(claimId);
    await get().loadForMember(workspaceId, memberId);
  },

  loadWorkspaceLinks: async (workspaceId) => {
    const links = await IdentityLinkService.listForWorkspace(workspaceId);
    set({ workspaceLinks: links });
  },

  approveWorkspaceLink: async (workspaceId, linkId) => {
    await IdentityLinkService.approve(workspaceId, linkId);
    await get().loadWorkspaceLinks(workspaceId);
  },

  rejectWorkspaceLink: async (workspaceId, linkId, reason) => {
    await IdentityLinkService.reject(workspaceId, linkId, reason);
    await get().loadWorkspaceLinks(workspaceId);
  },

  revokeWorkspaceLink: async (workspaceId, linkId, reason) => {
    await IdentityLinkService.revoke(workspaceId, linkId, reason);
    await get().loadWorkspaceLinks(workspaceId);
  },

  loadClaimInbox: async () => {
    const [incomingClaims, outgoingClaims] = await Promise.all([
      IdentityLinkService.listIncomingClaims(),
      IdentityLinkService.listOutgoingClaims(),
    ]);
    set({ incomingClaims, outgoingClaims });
  },

  declineClaim: async (claimId, reason) => {
    await IdentityLinkService.declineClaim(claimId, reason);
    await get().loadClaimInbox();
  },

  completeClaim: async (claimId, workspaceId, memberId) => {
    await IdentityLinkService.completeClaim(claimId, workspaceId, memberId);
    await get().loadClaimInbox();
  },

  cancelOutgoingClaim: async (claimId) => {
    await IdentityLinkService.cancelClaim(claimId);
    await get().loadClaimInbox();
  },

  // Workspace-scoped caches only — the global claims inbox
  // (incoming/outgoing) belongs to the user, not the open workspace, and
  // must survive a workspace switch (#1014).
  clearWorkspaceScoped: () =>
    set({
      linksByMember: {},
      claimsByMember: {},
      workspaceLinks: [],
    }),

  clear: () =>
    set({
      linksByMember: {},
      claimsByMember: {},
      workspaceLinks: [],
      incomingClaims: [],
      outgoingClaims: [],
    }),
}));

/** Reactive selector for the global Identity Links tab's badge count. */
export const useIncomingIdentityClaimCount = (): number =>
  useIdentityLinkStore((s) => s.incomingClaims.length);
