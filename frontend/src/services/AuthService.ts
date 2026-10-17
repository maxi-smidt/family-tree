import { api } from "@/services/api";
import { ShareCandidate, Workspace, WorkspaceAccess } from "@/types/workspace";
import { TotpSetupResponse, User } from "@/types/user";

export interface TwoFactorSetup {
  setup: TotpSetupResponse;
  qrDataUrl: string;
}

/** Focused transport client for authenticated account-management workflows. */
export const AuthService = {
  async setupTwoFactor(): Promise<TwoFactorSetup> {
    const setup = await api.post<TotpSetupResponse>("/auth/2fa/setup");
    const qr = await api.get<{ data_url: string }>("/auth/2fa/qr-code");
    return { setup, qrDataUrl: qr.data_url };
  },

  enableTwoFactor(code: string): Promise<void> {
    return api.post<void>("/auth/2fa/enable", { code });
  },

  disableTwoFactor(password: string, code: string): Promise<void> {
    return api.post<void>("/auth/2fa/disable", { password, code });
  },

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return api.post<void>("/auth/password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  updateProfile(firstName: string, lastName: string): Promise<User> {
    return api.patch<User>("/auth/profile", {
      first_name: firstName,
      last_name: lastName,
    });
  },

  uploadProfileImage(file: File): Promise<User> {
    const form = new FormData();
    form.append("image", file);
    return api.postForm<User>("/auth/profile/image", form);
  },

  removeProfileImage(): Promise<User> {
    return api.del<User>("/auth/profile/image");
  },

  deleteAccount(
    password: string | null,
    confirmUsername: string | null,
  ): Promise<User> {
    return api.post<User>("/auth/delete-account", {
      password,
      confirm_username: confirmUsername,
    });
  },

  async getOwnedTrees(): Promise<Workspace[]> {
    const workspaces = await api.get<Workspace[]>("/workspaces");
    return workspaces.filter((tree) => tree.role === "owner");
  },

  async getOwnershipTransferTargets(
    workspaceId: string,
  ): Promise<Array<{ user_id: string; username: string }>> {
    const [accessList, candidates] = await Promise.all([
      api.get<WorkspaceAccess[]>(`/workspaces/${workspaceId}/access`),
      api.get<ShareCandidate[]>(`/workspaces/${workspaceId}/access/candidates`),
    ]);
    return [
      ...accessList
        .filter((access) => access.role !== "owner")
        .map((access) => ({
          user_id: access.user_id,
          username: access.username,
        })),
      ...candidates,
    ].sort((left, right) => left.username.localeCompare(right.username));
  },

  transferOwnership(workspaceId: string, username: string): Promise<void> {
    return api.post<void>(`/workspaces/${workspaceId}/transfer`, { username });
  },
};
