export interface User {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  auth_provider: string;
  created_at: string;
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
