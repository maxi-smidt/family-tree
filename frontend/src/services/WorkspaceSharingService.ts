import { api } from "@/services/api";
import {
  InvitationAcceptResult,
  InvitationPreview,
  ShareCandidate,
  ShareRole,
  Workspace,
  WorkspaceAccess,
  WorkspaceInvitation,
  WorkspaceTransferResult,
} from "@/types/workspace";

export interface WorkspaceSharingData {
  access: WorkspaceAccess[];
  candidates: ShareCandidate[];
}

function getAccess(workspaceId: string): Promise<WorkspaceAccess[]> {
  return api.get<WorkspaceAccess[]>(`/workspaces/${workspaceId}/access`);
}

function getCandidates(workspaceId: string): Promise<ShareCandidate[]> {
  return api.get<ShareCandidate[]>(`/workspaces/${workspaceId}/access/candidates`);
}

export const WorkspaceSharingService = {
  getAccess(workspaceId: string): Promise<WorkspaceAccess[]> {
    return getAccess(workspaceId);
  },

  getCandidates(workspaceId: string): Promise<ShareCandidate[]> {
    return getCandidates(workspaceId);
  },

  async getSharingData(workspaceId: string): Promise<WorkspaceSharingData> {
    const [access, candidates] = await Promise.all([
      getAccess(workspaceId),
      getCandidates(workspaceId),
    ]);
    return { access, candidates };
  },

  grantAccess(
    workspaceId: string,
    username: string,
    role: ShareRole,
  ): Promise<WorkspaceAccess[]> {
    return api.post<WorkspaceAccess[]>(`/workspaces/${workspaceId}/access`, {
      username,
      role,
    });
  },

  revokeAccess(workspaceId: string, userId: string): Promise<void> {
    return api.del<void>(`/workspaces/${workspaceId}/access/${userId}`);
  },

  updateMemberRestrictions(
    workspaceId: string,
    userId: string,
    restrictions: string[],
  ): Promise<WorkspaceAccess[]> {
    return api.patch<WorkspaceAccess[]>(
      `/workspaces/${workspaceId}/access/${userId}/restrictions`,
      { restrictions },
    );
  },

  transferOwnership(
    workspaceId: string,
    username: string,
    retainRole?: ShareRole,
  ): Promise<WorkspaceTransferResult> {
    return api.post<WorkspaceTransferResult>(`/workspaces/${workspaceId}/transfer`, {
      username,
      retain_role: retainRole ?? null,
    });
  },

  revertTransfer(workspaceId: string): Promise<WorkspaceTransferResult> {
    return api.post<WorkspaceTransferResult>(`/workspaces/${workspaceId}/transfer/revert`, {});
  },

  listInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return api.get<WorkspaceInvitation[]>(`/workspaces/${workspaceId}/invitations`);
  },

  createInvitation(
    workspaceId: string,
    opts: { email?: string; role: ShareRole; expiresInDays?: number },
  ): Promise<WorkspaceInvitation> {
    return api.post<WorkspaceInvitation>(`/workspaces/${workspaceId}/invitations`, {
      email: opts.email ?? null,
      role: opts.role,
      expires_in_days: opts.expiresInDays ?? null,
    });
  },

  revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
    return api.del<void>(`/workspaces/${workspaceId}/invitations/${invitationId}`);
  },

  previewInvite(token: string): Promise<InvitationPreview> {
    return api.get<InvitationPreview>(`/invites/${token}`);
  },

  acceptInvite(token: string): Promise<InvitationAcceptResult> {
    return api.post<InvitationAcceptResult>(`/invites/${token}/accept`, {});
  },

  setPublicAccess(workspaceId: string, publicRole: "viewer" | null): Promise<Workspace> {
    return api.patch<Workspace>(`/workspaces/${workspaceId}/public`, {
      public_role: publicRole,
    });
  },

  setPublicPassword(workspaceId: string, password: string | null): Promise<Workspace> {
    return api.put<Workspace>(`/workspaces/${workspaceId}/public/password`, { password });
  },

  unlockPublicTree(
    workspaceId: string,
    password: string,
  ): Promise<{ token: string }> {
    return api.post<{ token: string }>(`/workspaces/${workspaceId}/public/unlock`, {
      password,
    });
  },

  grantAccessBatch(
    workspaceId: string,
    username: string,
    role: ShareRole,
    workspaceIds: string[],
  ): Promise<WorkspaceAccess[]> {
    return api.post<WorkspaceAccess[]>(`/workspaces/${workspaceId}/access/batch`, {
      username,
      role,
      workspace_ids: workspaceIds,
    });
  },

  revokeAccessBatch(
    workspaceId: string,
    userId: string,
    workspaceIds: string[],
  ): Promise<void> {
    return api.post<void>(`/workspaces/${workspaceId}/access/batch-revoke`, {
      user_id: userId,
      workspace_ids: workspaceIds,
    });
  },
};
