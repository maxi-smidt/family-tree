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
}

export interface AuthConfig {
  authentik_enabled: boolean;
  allow_self_registration: boolean;
  authentik_login_url: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}
