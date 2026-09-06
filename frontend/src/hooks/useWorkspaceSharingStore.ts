import { create } from "zustand";
import { WorkspaceSharingService } from "@/services/WorkspaceSharingService";
import {
  ShareRole,
  Workspace,
  WorkspaceAccess,
  WorkspaceInvitation,
} from "@/types/workspace";

interface SharingLoadOptions {
  includeInvitations: boolean;
}

interface WorkspaceSharingState {
  workspaceId: string | null;
  access: WorkspaceAccess[];
  candidates: Array<{ user_id: string; username: string }>;
  invitations: WorkspaceInvitation[];
  loading: boolean;
  error: string | null;
  load: (workspaceId: string, options: SharingLoadOptions) => Promise<void>;
  grantAccess: (workspaceId: string, username: string, role: ShareRole) => Promise<WorkspaceAccess[]>;
  revokeAccess: (workspaceId: string, userId: string) => Promise<void>;
  updateMemberRestrictions: (workspaceId: string, userId: string, restrictions: string[]) => Promise<WorkspaceAccess[]>;
  transferOwnership: (workspaceId: string, username: string, retainRole?: ShareRole) => ReturnType<typeof WorkspaceSharingService.transferOwnership>;
  revertTransfer: (workspaceId: string) => ReturnType<typeof WorkspaceSharingService.revertTransfer>;
  createInvitation: (workspaceId: string, options: { email?: string; role: ShareRole; expiresInDays?: number }) => Promise<WorkspaceInvitation>;
  revokeInvitation: (workspaceId: string, invitationId: string) => Promise<void>;
  setPublicAccess: (workspaceId: string, publicRole: "viewer" | null) => Promise<Workspace>;
  setPublicPassword: (workspaceId: string, password: string | null) => Promise<Workspace>;
  grantAccessBatch: (workspaceId: string, username: string, role: ShareRole, workspaceIds: string[]) => Promise<WorkspaceAccess[]>;
  revokeAccessBatch: (workspaceId: string, userId: string, workspaceIds: string[]) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export const useWorkspaceSharingStore = create<WorkspaceSharingState>((set, get) => {
  const run = async <T>(workspaceId: string, action: () => Promise<T>): Promise<T> => {
    const switchingTrees = get().workspaceId !== workspaceId;
    set({
      workspaceId,
      loading: true,
      error: null,
      ...(switchingTrees
        ? { access: [], candidates: [], invitations: [] }
        : {}),
    });
    try {
      return await action();
    } catch (error) {
      if (get().workspaceId === workspaceId) set({ error: errorMessage(error) });
      throw error;
    } finally {
      if (get().workspaceId === workspaceId) set({ loading: false });
    }
  };

  return {
    workspaceId: null,
    access: [],
    candidates: [],
    invitations: [],
    loading: false,
    error: null,

    load: async (workspaceId, options) => {
      const data = await run(workspaceId, async () => {
        const [sharing, invitations] = await Promise.all([
          WorkspaceSharingService.getSharingData(workspaceId),
          options.includeInvitations
            ? WorkspaceSharingService.listInvitations(workspaceId)
            : Promise.resolve([]),
        ]);
        return { ...sharing, invitations };
      });
      if (get().workspaceId === workspaceId) {
        set(data);
      }
    },

    grantAccess: (workspaceId, username, role) =>
      run(workspaceId, () => WorkspaceSharingService.grantAccess(workspaceId, username, role)),
    revokeAccess: (workspaceId, userId) =>
      run(workspaceId, () => WorkspaceSharingService.revokeAccess(workspaceId, userId)),
    updateMemberRestrictions: (workspaceId, userId, restrictions) =>
      run(workspaceId, () =>
        WorkspaceSharingService.updateMemberRestrictions(workspaceId, userId, restrictions),
      ),
    transferOwnership: (workspaceId, username, retainRole) =>
      run(workspaceId, () =>
        WorkspaceSharingService.transferOwnership(workspaceId, username, retainRole),
      ),
    revertTransfer: (workspaceId) =>
      run(workspaceId, () => WorkspaceSharingService.revertTransfer(workspaceId)),
    createInvitation: (workspaceId, options) =>
      run(workspaceId, () => WorkspaceSharingService.createInvitation(workspaceId, options)),
    revokeInvitation: (workspaceId, invitationId) =>
      run(workspaceId, () => WorkspaceSharingService.revokeInvitation(workspaceId, invitationId)),
    setPublicAccess: (workspaceId, publicRole) =>
      run(workspaceId, () => WorkspaceSharingService.setPublicAccess(workspaceId, publicRole)),
    setPublicPassword: (workspaceId, password) =>
      run(workspaceId, () => WorkspaceSharingService.setPublicPassword(workspaceId, password)),
    grantAccessBatch: (workspaceId, username, role, workspaceIds) =>
      run(workspaceId, () =>
        WorkspaceSharingService.grantAccessBatch(workspaceId, username, role, workspaceIds),
      ),
    revokeAccessBatch: (workspaceId, userId, workspaceIds) =>
      run(workspaceId, () =>
        WorkspaceSharingService.revokeAccessBatch(workspaceId, userId, workspaceIds),
      ),
  };
});
