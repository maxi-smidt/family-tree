export type ImageStorageMode = "compressed" | "original" | "both";

export interface User {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  auth_provider: string;
  created_at: string;
  /** Absolute purge deadline; non-null means the account is pending deletion. */
  deletion_scheduled_for?: string | null;
  deletion_requested_by?: string | null;
  /** Resolved feature-flag set; only present on login/me responses. */
  features?: string[];
  /** Whether TOTP 2FA is active on this account. */
  totp_enabled?: boolean;
  /** Per-user storage quota overrides (null = use instance default; 0 = unlimited). */
  tree_quota_bytes?: number | null;
  media_quota_bytes?: number | null;
  /** Effective gallery image storage mode (user pref or admin default). */
  image_storage_mode?: ImageStorageMode;
  /** Modes the admin has explicitly allowed; user may only pick from these. */
  image_storage_allowed_modes?: ImageStorageMode[];
  /** Whether the instance requires Legal Terms/Privacy acceptance (admin setting). */
  legal_acceptance_required?: boolean;
  /** Whether this user has accepted the currently published legal version. */
  legal_accepted?: boolean;
}

export interface AuthConfig {
  authentik_enabled: boolean;
  allow_self_registration: boolean;
  authentik_login_url: string | null;
  media_limits: {
    max_image_bytes: number;
    max_image_dimension: number;
    max_document_bytes: number;
    stored_image_width: number;
    stored_image_height: number;
    image_storage_mode: ImageStorageMode;
    image_storage_allowed_modes: ImageStorageMode[];
  };
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface LoginResponse {
  access_token?: string | null;
  token_type?: string;
  user?: User | null;
  totp_required?: boolean;
  totp_session_token?: string | null;
}

export interface TotpSetupResponse {
  secret: string;
  otpauth_url: string;
  recovery_codes: string[];
}
