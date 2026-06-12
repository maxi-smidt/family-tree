import { api } from "@/services/api";
import { ShareCandidate, ShareRole, TreeAccess } from "@/types/tree";

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

  transferOwnership(treeId: string, username: string): Promise<void> {
    return api.post<void>(`/trees/${treeId}/transfer`, { username });
  },
};
