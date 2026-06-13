import { api } from "@/services/api";
import { User } from "@/types/user";
import { FeatureName } from "@/lib/features";
import { RelationTypeDB } from "@/types/member";

export interface AdminSettings {
  allow_self_registration: boolean;
  instance_name: string;
  default_language: string;
  deletion_grace_period_days: number;
  backup_schedule_enabled: boolean;
  backup_interval_hours: number;
  backup_retention_count: number;
}

export interface BackupRecord {
  id: string;
  created_at: string;
  status: "running" | "success" | "failed";
  trigger: "manual" | "scheduled";
  filename: string | null;
  size_bytes: number | null;
  error: string | null;
}

export type FeatureState = "on" | "off" | "beta";

export interface FeatureFlag {
  name: FeatureName;
  state: FeatureState;
  /** User ids allowed to use the feature while it is in `beta`. */
  allowlist: string[];
}

export interface FeatureFlagUpdate {
  state?: FeatureState;
  allowlist?: string[];
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

  listFeatures(): Promise<FeatureFlag[]> {
    return api.get<FeatureFlag[]>("/admin/features");
  },

  updateFeature(
    name: string,
    changes: FeatureFlagUpdate,
  ): Promise<FeatureFlag> {
    return api.patch<FeatureFlag>(`/admin/features/${name}`, changes);
  },

  listBackups(): Promise<BackupRecord[]> {
    return api.get<BackupRecord[]>("/admin/backups");
  },

  triggerBackup(): Promise<BackupRecord> {
    return api.post<BackupRecord>("/admin/backups");
  },

  deleteBackup(id: string): Promise<void> {
    return api.del<void>(`/admin/backups/${id}`);
  },

  downloadBackupUrl(id: string): string {
    const base = import.meta.env.VITE_API_BASE_URL || "/api";
    return `${base}/admin/backups/${id}/download`;
  },

  listRelationTypes(): Promise<RelationTypeDB[]> {
    return api.get<RelationTypeDB[]>("/relation-types");
  },

  createRelationType(
    id: string,
    description: string | null,
  ): Promise<RelationTypeDB> {
    return api.post<RelationTypeDB>("/admin/relation-types", {
      id,
      description,
    });
  },

  updateRelationType(
    id: string,
    description: string | null,
  ): Promise<RelationTypeDB> {
    return api.patch<RelationTypeDB>(`/admin/relation-types/${id}`, {
      description,
    });
  },

  deleteRelationType(id: string): Promise<void> {
    return api.del<void>(`/admin/relation-types/${id}`);
  },
};
