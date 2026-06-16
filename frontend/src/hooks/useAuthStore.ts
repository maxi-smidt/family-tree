import { create } from "zustand";
import {
  api,
  getAuthToken,
  onUnauthorized,
  setAuthToken,
} from "@/services/api";
import { TreeSharingService } from "@/services/TreeSharingService";
import { AuthConfig, LoginResponse, TokenResponse, User } from "@/types/user";
import { FeatureName } from "@/lib/features";
import { decodeJwtExp } from "@/lib/utils";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Feature flags resolved for this user by the backend (login/me). */
  features: string[];
  config: AuthConfig | null;
  sessionExpiringSoon: boolean;
  reloginRequired: boolean;
  /** Token stored from an #invite= URL hash; consumed after login/register. */
  pendingInviteToken: string | null;
  /** Tree ID from a #public= URL hash; enables anonymous public tree viewing. */
  pendingPublicTreeId: string | null;
  /** Set after password check when the account has TOTP enabled. */
  totpRequired: boolean;
  totpSessionToken: string | null;
  init: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
  cancelTotp: () => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
  deleteAccount: (
    password: string | null,
    confirmUsername: string | null,
  ) => Promise<User>;
  restoreAccount: (username: string, password: string) => Promise<void>;
  acceptPendingInvite: () => Promise<string | null>;
}

let expiryCheckInterval: ReturnType<typeof setInterval> | null = null;

function startExpiryCheck() {
  if (expiryCheckInterval) clearInterval(expiryCheckInterval);
  expiryCheckInterval = setInterval(() => {
    const token = getAuthToken();
    if (!token) return;
    const exp = decodeJwtExp(token);
    if (exp === null) return;
    const msTillExpiry = exp * 1000 - Date.now();
    useAuthStore.setState({
      sessionExpiringSoon: msTillExpiry > 0 && msTillExpiry < 60 * 60 * 1000,
    });
  }, 60_000);
  // Run immediately too
  const token = getAuthToken();
  if (token) {
    const exp = decodeJwtExp(token);
    if (exp !== null) {
      const msTillExpiry = exp * 1000 - Date.now();
      useAuthStore.setState({
        sessionExpiringSoon: msTillExpiry > 0 && msTillExpiry < 60 * 60 * 1000,
      });
    }
  }
}

function applyToken(res: TokenResponse) {
  setAuthToken(res.access_token);
  useAuthStore.setState({
    user: res.user,
    features: res.user.features ?? [],
    status: "authenticated",
    reloginRequired: false,
    sessionExpiringSoon: false,
    totpRequired: false,
    totpSessionToken: null,
  });
  startExpiryCheck();
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  features: [],
  config: null,
  sessionExpiringSoon: false,
  reloginRequired: false,
  pendingInviteToken: null,
  pendingPublicTreeId: null,
  totpRequired: false,
  totpSessionToken: null,

  refreshConfig: async () => {
    const config = await api.get<AuthConfig>("/auth/config");
    set({ config });
  },

  init: async () => {
    // Pick up a token handed back by the Authentik OAuth redirect (#token=...).
    const hash = window.location.hash;
    if (hash.startsWith("#token=")) {
      const token = decodeURIComponent(hash.slice("#token=".length));
      setAuthToken(token);
      window.history.replaceState(null, "", window.location.pathname);
    } else if (hash.startsWith("#invite=")) {
      const inviteToken = decodeURIComponent(hash.slice("#invite=".length));
      set({ pendingInviteToken: inviteToken });
      window.history.replaceState(null, "", window.location.pathname);
    } else if (hash.startsWith("#public=")) {
      const treeId = decodeURIComponent(hash.slice("#public=".length));
      set({ pendingPublicTreeId: treeId });
      window.history.replaceState(null, "", window.location.pathname);
    }

    try {
      const config = await api.get<AuthConfig>("/auth/config");
      set({ config });
    } catch {
      // backend unreachable; keep going so the login screen can still render
    }

    try {
      const user = await api.get<User>("/auth/me");
      set({
        user,
        features: user.features ?? [],
        status: "authenticated",
        reloginRequired: false,
        sessionExpiringSoon: false,
      });
      startExpiryCheck();
    } catch {
      setAuthToken(null);
      set({ user: null, features: [], status: "unauthenticated" });
    }
  },

  login: async (username: string, password: string) => {
    const res = await api.post<LoginResponse>("/auth/login", {
      username,
      password,
    });
    if (res.totp_required && res.totp_session_token) {
      set({ totpRequired: true, totpSessionToken: res.totp_session_token });
      return;
    }
    applyToken(res as TokenResponse);
  },

  verifyTotp: async (code: string) => {
    const { totpSessionToken } = useAuthStore.getState();
    if (!totpSessionToken) throw new Error("No TOTP session");
    const res = await api.post<TokenResponse>("/auth/totp", {
      session_token: totpSessionToken,
      code,
    });
    applyToken(res);
  },

  cancelTotp: () => {
    set({ totpRequired: false, totpSessionToken: null });
  },

  logout: () => {
    if (expiryCheckInterval) {
      clearInterval(expiryCheckInterval);
      expiryCheckInterval = null;
    }
    setAuthToken(null);
    set({
      user: null,
      features: [],
      status: "unauthenticated",
      sessionExpiringSoon: false,
      reloginRequired: false,
      totpRequired: false,
      totpSessionToken: null,
    });
  },

  refreshMe: async () => {
    const user = await api.get<User>("/auth/me");
    set({ user, features: user.features ?? [] });
  },

  deleteAccount: async (
    password: string | null,
    confirmUsername: string | null,
  ) => {
    return await api.post<User>("/auth/delete-account", {
      password,
      confirm_username: confirmUsername,
    });
  },

  restoreAccount: async (username: string, password: string) => {
    const res = await api.post<TokenResponse>("/auth/restore-account", {
      username,
      password,
    });
    applyToken(res);
  },

  acceptPendingInvite: async () => {
    const { pendingInviteToken } = useAuthStore.getState();
    if (!pendingInviteToken) return null;
    try {
      const result = await TreeSharingService.acceptInvite(pendingInviteToken);
      set({ pendingInviteToken: null });
      return result.tree_id;
    } catch {
      set({ pendingInviteToken: null });
      return null;
    }
  },
}));

/** Reactive hook: is the feature enabled for the current user? */
export const useFeature = (feature: FeatureName): boolean =>
  useAuthStore((s) => s.features.includes(feature));

/** Non-reactive check for store actions and other non-component code. */
export const hasFeature = (feature: FeatureName): boolean =>
  useAuthStore.getState().features.includes(feature);

// Any 401 from the API triggers a relogin dialog instead of a hard logout,
// so the user can re-authenticate in-place without losing UI state.
// Guard against 401 storms: only transition once; subsequent 401s while the
// dialog is already open are no-ops.
onUnauthorized(() => {
  const { status, reloginRequired } = useAuthStore.getState();
  if (status === "authenticated" && !reloginRequired) {
    useAuthStore.setState({ reloginRequired: true });
  }
});
