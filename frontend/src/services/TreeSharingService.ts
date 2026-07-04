import { api } from "@/services/api";
import {
  InvitationAcceptResult,
  InvitationPreview,
  LinkedShareTree,
  ShareCandidate,
  ShareRole,
  Tree,
  TreeAccess,
  TreeInvitation,
  TreeTransferResult,
} from "@/types/tree";

export interface TreeSharingData {
  access: TreeAccess[];
  candidates: ShareCandidate[];
}

function getAccess(treeId: string): Promise<TreeAccess[]> {
  return api.get<TreeAccess[]>(`/trees/${treeId}/access`);
}

function getCandidates(treeId: string): Promise<ShareCandidate[]> {
  return api.get<ShareCandidate[]>(`/trees/${treeId}/access/candidates`);
}

export const TreeSharingService = {
  getAccess(treeId: string): Promise<TreeAccess[]> {
    return getAccess(treeId);
  },

  getCandidates(treeId: string): Promise<ShareCandidate[]> {
    return getCandidates(treeId);
  },

  async getSharingData(treeId: string): Promise<TreeSharingData> {
    const [access, candidates] = await Promise.all([
      getAccess(treeId),
      getCandidates(treeId),
    ]);
    return { access, candidates };
  },

  grantAccess(
    treeId: string,
    username: string,
    role: ShareRole,
  ): Promise<TreeAccess[]> {
    return api.post<TreeAccess[]>(`/trees/${treeId}/access`, {
      username,
      role,
    });
  },

  revokeAccess(treeId: string, userId: string): Promise<void> {
    return api.del<void>(`/trees/${treeId}/access/${userId}`);
  },

  updateMemberRestrictions(
    treeId: string,
    userId: string,
    restrictions: string[],
  ): Promise<TreeAccess[]> {
    return api.patch<TreeAccess[]>(
      `/trees/${treeId}/access/${userId}/restrictions`,
      { restrictions },
    );
  },

  transferOwnership(
    treeId: string,
    username: string,
    retainRole?: ShareRole,
  ): Promise<TreeTransferResult> {
    return api.post<TreeTransferResult>(`/trees/${treeId}/transfer`, {
      username,
      retain_role: retainRole ?? null,
    });
  },

  revertTransfer(treeId: string): Promise<TreeTransferResult> {
    return api.post<TreeTransferResult>(`/trees/${treeId}/transfer/revert`, {});
  },

  listInvitations(treeId: string): Promise<TreeInvitation[]> {
    return api.get<TreeInvitation[]>(`/trees/${treeId}/invitations`);
  },

  createInvitation(
    treeId: string,
    opts: { email?: string; role: ShareRole; expiresInDays?: number },
  ): Promise<TreeInvitation> {
    return api.post<TreeInvitation>(`/trees/${treeId}/invitations`, {
      email: opts.email ?? null,
      role: opts.role,
      expires_in_days: opts.expiresInDays ?? null,
    });
  },

  revokeInvitation(treeId: string, invitationId: string): Promise<void> {
    return api.del<void>(`/trees/${treeId}/invitations/${invitationId}`);
  },

  previewInvite(token: string): Promise<InvitationPreview> {
    return api.get<InvitationPreview>(`/invites/${token}`);
  },

  acceptInvite(token: string): Promise<InvitationAcceptResult> {
    return api.post<InvitationAcceptResult>(`/invites/${token}/accept`, {});
  },

  setPublicAccess(treeId: string, publicRole: "viewer" | null): Promise<Tree> {
    return api.patch<Tree>(`/trees/${treeId}/public`, {
      public_role: publicRole,
    });
  },

  getLinkedShareTrees(
    treeId: string,
    username?: string,
  ): Promise<LinkedShareTree[]> {
    return api.get<LinkedShareTree[]>(`/trees/${treeId}/access/linked-trees`, {
      username,
    });
  },

  grantAccessBatch(
    treeId: string,
    username: string,
    role: ShareRole,
    treeIds: string[],
  ): Promise<TreeAccess[]> {
    return api.post<TreeAccess[]>(`/trees/${treeId}/access/batch`, {
      username,
      role,
      tree_ids: treeIds,
    });
  },

  revokeAccessBatch(
    treeId: string,
    userId: string,
    treeIds: string[],
  ): Promise<void> {
    return api.post<void>(`/trees/${treeId}/access/batch-revoke`, {
      user_id: userId,
      tree_ids: treeIds,
    });
  },
};
