import { create } from "zustand";
import { ApiError } from "@/services/api";
import { TreeSharingService } from "@/services/TreeSharingService";
import {
  LinkedShareTree,
  ShareRole,
  Tree,
  TreeAccess,
  TreeInvitation,
} from "@/types/tree";

interface SharingLoadOptions {
  includeInvitations: boolean;
  includeLinkedTrees: boolean;
}

interface TreeSharingState {
  treeId: string | null;
  access: TreeAccess[];
  candidates: Array<{ user_id: string; username: string }>;
  invitations: TreeInvitation[];
  linkedTrees: LinkedShareTree[];
  loading: boolean;
  error: string | null;
  load: (treeId: string, options: SharingLoadOptions) => Promise<void>;
  grantAccess: (treeId: string, username: string, role: ShareRole) => Promise<TreeAccess[]>;
  revokeAccess: (treeId: string, userId: string) => Promise<void>;
  updateMemberRestrictions: (treeId: string, userId: string, restrictions: string[]) => Promise<TreeAccess[]>;
  transferOwnership: (treeId: string, username: string, retainRole?: ShareRole) => ReturnType<typeof TreeSharingService.transferOwnership>;
  revertTransfer: (treeId: string) => ReturnType<typeof TreeSharingService.revertTransfer>;
  createInvitation: (treeId: string, options: { email?: string; role: ShareRole; expiresInDays?: number }) => Promise<TreeInvitation>;
  revokeInvitation: (treeId: string, invitationId: string) => Promise<void>;
  setPublicAccess: (treeId: string, publicRole: "viewer" | null) => Promise<Tree>;
  setPublicPassword: (treeId: string, password: string | null) => Promise<Tree>;
  getLinkedShareTrees: (treeId: string, username?: string) => Promise<LinkedShareTree[]>;
  grantAccessBatch: (treeId: string, username: string, role: ShareRole, treeIds: string[]) => Promise<TreeAccess[]>;
  revokeAccessBatch: (treeId: string, userId: string, treeIds: string[]) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export const useTreeSharingStore = create<TreeSharingState>((set, get) => {
  const run = async <T>(treeId: string, action: () => Promise<T>): Promise<T> => {
    const switchingTrees = get().treeId !== treeId;
    set({
      treeId,
      loading: true,
      error: null,
      ...(switchingTrees
        ? { access: [], candidates: [], invitations: [], linkedTrees: [] }
        : {}),
    });
    try {
      return await action();
    } catch (error) {
      if (get().treeId === treeId) set({ error: errorMessage(error) });
      throw error;
    } finally {
      if (get().treeId === treeId) set({ loading: false });
    }
  };

  return {
    treeId: null,
    access: [],
    candidates: [],
    invitations: [],
    linkedTrees: [],
    loading: false,
    error: null,

    load: async (treeId, options) => {
      const data = await run(treeId, async () => {
        const [sharing, invitations, linkedTrees] = await Promise.all([
          TreeSharingService.getSharingData(treeId),
          options.includeInvitations
            ? TreeSharingService.listInvitations(treeId)
            : Promise.resolve([]),
          options.includeLinkedTrees
            ? TreeSharingService.getLinkedShareTrees(treeId).catch((error) => {
                if (error instanceof ApiError && error.status === 404) return [];
                throw error;
              })
            : Promise.resolve([]),
        ]);
        return { ...sharing, invitations, linkedTrees };
      });
      if (get().treeId === treeId) {
        set(data);
      }
    },

    grantAccess: (treeId, username, role) =>
      run(treeId, () => TreeSharingService.grantAccess(treeId, username, role)),
    revokeAccess: (treeId, userId) =>
      run(treeId, () => TreeSharingService.revokeAccess(treeId, userId)),
    updateMemberRestrictions: (treeId, userId, restrictions) =>
      run(treeId, () =>
        TreeSharingService.updateMemberRestrictions(treeId, userId, restrictions),
      ),
    transferOwnership: (treeId, username, retainRole) =>
      run(treeId, () =>
        TreeSharingService.transferOwnership(treeId, username, retainRole),
      ),
    revertTransfer: (treeId) =>
      run(treeId, () => TreeSharingService.revertTransfer(treeId)),
    createInvitation: (treeId, options) =>
      run(treeId, () => TreeSharingService.createInvitation(treeId, options)),
    revokeInvitation: (treeId, invitationId) =>
      run(treeId, () => TreeSharingService.revokeInvitation(treeId, invitationId)),
    setPublicAccess: (treeId, publicRole) =>
      run(treeId, () => TreeSharingService.setPublicAccess(treeId, publicRole)),
    setPublicPassword: (treeId, password) =>
      run(treeId, () => TreeSharingService.setPublicPassword(treeId, password)),
    getLinkedShareTrees: (treeId, username) =>
      run(treeId, () => TreeSharingService.getLinkedShareTrees(treeId, username)),
    grantAccessBatch: (treeId, username, role, treeIds) =>
      run(treeId, () =>
        TreeSharingService.grantAccessBatch(treeId, username, role, treeIds),
      ),
    revokeAccessBatch: (treeId, userId, treeIds) =>
      run(treeId, () =>
        TreeSharingService.revokeAccessBatch(treeId, userId, treeIds),
      ),
  };
});
