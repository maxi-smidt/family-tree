import { api } from "@/services/api";
import { User, ImageStorageMode } from "@/types/user";
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
  max_image_upload_mb: number;
  max_image_dimension: number;
  max_document_upload_mb: number;
  default_tree_quota_mb: number;
  default_media_quota_mb: number;
  image_storage_mode: ImageStorageMode;
  image_storage_allowed_modes: ImageStorageMode[];
  announcement_title: string;
  announcement_body: string;
  announcement_version: string;
  legal_acceptance_required: boolean;
  legal_version: string;
  legal_terms_body_de: string;
  legal_terms_body_en: string;
  legal_privacy_body_de: string;
  legal_privacy_body_en: string;
  legal_imprint_body_de: string;
  legal_imprint_body_en: string;
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

export interface AdminAuditEntry {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: "create" | "update" | "delete";
  subject_type: string;
  subject_id: string | null;
  subject_label: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminAuditPage {
  items: AdminAuditEntry[];
  /** Total rows matching the active filters, across all pages. */
  total: number;
  limit: number;
  offset: number;
}

export interface AdminAuditFilters {
  action?: string;
  subjectType?: string;
  actor?: string;
  /** Inclusive lower bound; a bare `YYYY-MM-DD` covers the whole day. */
  start?: string;
  /** Inclusive upper bound; a bare `YYYY-MM-DD` covers the whole day. */
  end?: string;
}

function auditParams(
  filters: AdminAuditFilters & { limit?: number; offset?: number },
): Record<string, string | number | undefined> {
  return {
    limit: filters.limit,
    offset: filters.offset,
    action: filters.action || undefined,
    subject_type: filters.subjectType || undefined,
    actor: filters.actor || undefined,
    start: filters.start || undefined,
    end: filters.end || undefined,
  };
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

export type AdminUserUpdate = Partial<
  Pick<
    User,
    "is_admin" | "is_active" | "tree_quota_bytes" | "media_quota_bytes"
  >
>;

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

  resetUserTotp(userId: string): Promise<void> {
    return api.del<void>(`/users/${userId}/2fa`);
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

  listAuditLog(
    filters: AdminAuditFilters & { limit?: number; offset?: number } = {},
  ): Promise<AdminAuditPage> {
    return api.get<AdminAuditPage>("/admin/audit-log", auditParams(filters));
  },

  listAuditSubjectTypes(): Promise<string[]> {
    return api.get<string[]>("/admin/audit-log/subject-types");
  },

  async exportAuditLog(filters: AdminAuditFilters = {}): Promise<Blob> {
    const response = await api.getRaw("/admin/audit-log/export", auditParams(filters));
    return response.blob();
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

  listRelationTypes(): Promise<RelationTypeDB[]> {
    return api.get<RelationTypeDB[]>("/relation-types");
  },

  createRelationType(payload: {
    id: string;
    description: string | null;
    label: string | null;
    color: string | null;
    stroke_width: number | null;
    stroke_dasharray: string | null;
  }): Promise<RelationTypeDB> {
    return api.post<RelationTypeDB>("/admin/relation-types", payload);
  },

  updateRelationType(
    id: string,
    changes: Partial<Omit<RelationTypeDB, "id">>,
  ): Promise<RelationTypeDB> {
    return api.patch<RelationTypeDB>(`/admin/relation-types/${id}`, changes);
  },

  deleteRelationType(id: string): Promise<void> {
    return api.del<void>(`/admin/relation-types/${id}`);
  },
};
