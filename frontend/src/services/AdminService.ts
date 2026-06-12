import { api } from "@/services/api";
import { User } from "@/types/user";

export interface AdminSettings {
  allow_self_registration: boolean;
  instance_name: string;
  default_language: string;
  deletion_grace_period_days: number;
}

export interface CreateAdminUserInput {
  username: string;
  password: string;
  email: string | null;
  is_admin: boolean;
}

export type AdminUserUpdate = Partial<Pick<User, "is_admin" | "is_active">>;

export const AdminService = {
  listUsers(): Promise<User[]> {
    return api.get<User[]>("/users");
  },

  getSettings(): Promise<AdminSettings> {
    return api.get<AdminSettings>("/settings");
  },

  createUser(user: CreateAdminUserInput): Promise<User> {
    return api.post<User>("/users", user);
  },

  updateUser(userId: string, changes: AdminUserUpdate): Promise<User> {
    return api.patch<User>(`/users/${userId}`, changes);
  },

  scheduleUserDeletion(userId: string): Promise<void> {
    return api.del<void>(`/users/${userId}`);
  },

  cancelUserDeletion(userId: string): Promise<void> {
    return api.post<void>(`/users/${userId}/cancel-deletion`);
  },

  resetUserPassword(userId: string, password: string): Promise<void> {
    return api.post<void>(`/users/${userId}/reset-password`, { password });
  },

  updateSettings(settings: AdminSettings): Promise<AdminSettings> {
    return api.patch<AdminSettings>("/settings", settings);
  },
};
