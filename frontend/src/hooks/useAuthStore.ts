import { create } from "zustand";
import {
  ApiError,
  api,
  getAuthToken,
  onUnauthorized,
  setAuthToken,
} from "@/services/api";
import { TreeSharingService } from "@/services/TreeSharingService";
import { AuthService, TwoFactorSetup } from "@/services/AuthService";
import { Tree } from "@/types/tree";
import { AuthConfig, LoginResponse, TokenResponse, User } from "@/types/user";
import { FeatureName } from "@/lib/features";
import { decodeJwtExp } from "@/lib/utils";

type AuthStatus =
  "loading" | "authenticated" | "unauthenticated" | "unreachable";
type AccountOperation =
  | "idle"
  | "setting-up-two-factor"
  | "enabling-two-factor"
  | "disabling-two-factor"
  | "changing-password"
  | "saving-profile"
  | "uploading-profile-image"
  | "removing-profile-image"
  | "deleting-account";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Feature flags resolved for this user by the backend (login/me). */
  features: string[];
  config: AuthConfig | null;
  sessionExpiringSoon: boolean;
  sessionRefreshFailed: boolean;
  reloginRequired: boolean;
  /** Token stored from an #invite= URL hash; consumed after login/register. */
  pendingInviteToken: string | null;
  /** Tree ID from a #public= URL hash; enables anonymous public tree viewing. */
  pendingPublicTreeId: string | null;
  /** Set after password check when the account has TOTP enabled. */
  totpRequired: boolean;
  totpSessionToken: string | null;
  /** Account-management mutation currently in flight. */
  accountOperation: AccountOperation;
  /** Last account-management operation failure, cleared when a new one begins. */
  accountError: string | null;
  init: () => Promise<void>;
  /** Re-runs the /auth/me check after a transient (network/5xx) failure. */
  retryAuthCheck: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
  cancelTotp: () => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
  refreshSession: () => Promise<void>;
  requireRelogin: () => void;
  deleteAccount: (
    password: string | null,
    confirmUsername: string | null,
  ) => Promise<User>;
  setupTwoFactor: () => Promise<TwoFactorSetup>;
  enableTwoFactor: (code: string) => Promise<void>;
  disableTwoFactor: (password: string, code: string) => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  updateProfile: (firstName: string, lastName: string) => Promise<void>;
  uploadProfileImage: (file: File) => Promise<void>;
  removeProfileImage: () => Promise<void>;
  loadOwnedTrees: () => Promise<Tree[]>;
  loadOwnershipTransferTargets: (
    treeId: string,
  ) => Promise<Array<{ user_id: string; username: string }>>;
  transferTreeOwnership: (treeId: string, username: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    email: string | null,
  ) => Promise<void>;
  restoreAccount: (username: string, password: string) => Promise<void>;
  acceptPendingInvite: () => Promise<string | null>;
}

// Bounds the startup /auth/config and /auth/me requests so a stalled
// connection reaches the "unreachable" retry state instead of hanging on
// the loading spinner forever.
const AUTH_CHECK_TIMEOUT_MS = 10_000;
const SESSION_WARNING_MS = 60 * 60 * 1000;
const SESSION_REFRESH_AHEAD_MS = 5 * 60 * 1000;
const SESSION_REFRESH_RETRY_MS = 60 * 1000;
const MAX_SESSION_REFRESH_RETRIES = 1;

let sessionWarningTimeout: ReturnType<typeof setTimeout> | null = null;
let sessionRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
let sessionRefreshRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let sessionRefreshRetries = 0;

function clearSessionTimers() {
  if (sessionWarningTimeout) clearTimeout(sessionWarningTimeout);
  if (sessionRefreshTimeout) clearTimeout(sessionRefreshTimeout);
  if (sessionRefreshRetryTimeout) clearTimeout(sessionRefreshRetryTimeout);
  sessionWarningTimeout = null;
  sessionRefreshTimeout = null;
  sessionRefreshRetryTimeout = null;
  sessionRefreshRetries = 0;
}

function startSessionMaintenance() {
  clearSessionTimers();
  const token = getAuthToken();
  const exp = token ? decodeJwtExp(token) : null;
  if (exp === null) return;

  const millisecondsUntilExpiry = exp * 1000 - Date.now();
  if (millisecondsUntilExpiry <= 0) {
    useAuthStore.getState().requireRelogin();
    return;
  }

  const showWarning = () => {
    useAuthStore.setState({ sessionExpiringSoon: true });
  };
  const refresh = () => {
    void useAuthStore.getState().refreshSession();
  };

  if (millisecondsUntilExpiry <= SESSION_WARNING_MS) {
    showWarning();
  } else {
    sessionWarningTimeout = setTimeout(
      showWarning,
      millisecondsUntilExpiry - SESSION_WARNING_MS,
    );
  }

  sessionRefreshTimeout = setTimeout(
    refresh,
    Math.max(0, millisecondsUntilExpiry - SESSION_REFRESH_AHEAD_MS),
  );
}

// Only a 401 (a definitive credential rejection) clears the token; network
// errors, timeouts, and 5xx responses are transient and leave it in place.
async function checkAuthSession(): Promise<void> {
  try {
    const user = await api.get<User>(
      "/auth/me",
      undefined,
      AUTH_CHECK_TIMEOUT_MS,
    );
    useAuthStore.setState({
      user,
      features: user.features ?? [],
      status: "authenticated",
      reloginRequired: false,
      sessionExpiringSoon: false,
      sessionRefreshFailed: false,
    });
    startSessionMaintenance();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setAuthToken(null);
      useAuthStore.setState({
        user: null,
        features: [],
        status: "unauthenticated",
      });
      return;
    }
    useAuthStore.setState({ status: "unreachable" });
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
    sessionRefreshFailed: false,
    totpRequired: false,
    totpSessionToken: null,
  });
  startSessionMaintenance();
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  features: [],
  config: null,
  sessionExpiringSoon: false,
  sessionRefreshFailed: false,
  reloginRequired: false,
  pendingInviteToken: null,
  pendingPublicTreeId: null,
  totpRequired: false,
  totpSessionToken: null,
  accountOperation: "idle",
  accountError: null,

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
      const config = await api.get<AuthConfig>(
        "/auth/config",
        undefined,
        AUTH_CHECK_TIMEOUT_MS,
      );
      set({ config });
    } catch {
      // backend unreachable; keep going so the login screen can still render
    }

    await checkAuthSession();
  },

  retryAuthCheck: () => checkAuthSession(),

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
    clearSessionTimers();
    setAuthToken(null);
    set({
      user: null,
      features: [],
      status: "unauthenticated",
      sessionExpiringSoon: false,
      sessionRefreshFailed: false,
      reloginRequired: false,
      totpRequired: false,
      totpSessionToken: null,
    });
  },

  refreshMe: async () => {
    const tokenBeforeRefresh = getAuthToken();
    const user = await api.get<User>("/auth/me");
    if (
      getAuthToken() !== tokenBeforeRefresh ||
      useAuthStore.getState().status !== "authenticated"
    ) {
      return;
    }
    set({ user, features: user.features ?? [] });
  },

  refreshSession: async () => {
    const tokenBeforeRefresh = getAuthToken();
    if (!tokenBeforeRefresh) return;

    try {
      const response = await api.post<TokenResponse>("/auth/refresh");
      // A logout or a manual re-login may have completed while this request was
      // in flight. Never overwrite that newer session with a stale response.
      if (getAuthToken() !== tokenBeforeRefresh) return;
      applyToken(response);
    } catch {
      if (
        getAuthToken() !== tokenBeforeRefresh ||
        useAuthStore.getState().status !== "authenticated"
      ) {
        return;
      }

      set({ sessionExpiringSoon: true, sessionRefreshFailed: true });
      const exp = decodeJwtExp(tokenBeforeRefresh);
      const millisecondsUntilExpiry = exp ? exp * 1000 - Date.now() : 0;
      if (
        sessionRefreshRetries < MAX_SESSION_REFRESH_RETRIES &&
        millisecondsUntilExpiry > 0
      ) {
        sessionRefreshRetries += 1;
        sessionRefreshRetryTimeout = setTimeout(
          () => void useAuthStore.getState().refreshSession(),
          Math.min(SESSION_REFRESH_RETRY_MS, millisecondsUntilExpiry),
        );
      }
    }
  },

  requireRelogin: () => {
    const { status, reloginRequired } = useAuthStore.getState();
    if (status === "authenticated" && !reloginRequired) {
      set({ reloginRequired: true });
    }
  },

  deleteAccount: async (
    password: string | null,
    confirmUsername: string | null,
  ) => {
    return runAccountOperation(set, "deleting-account", () =>
      AuthService.deleteAccount(password, confirmUsername),
    );
  },

  setupTwoFactor: () =>
    runAccountOperation(set, "setting-up-two-factor", () =>
      AuthService.setupTwoFactor(),
    ),

  enableTwoFactor: async (code: string) => {
    await runAccountOperation(set, "enabling-two-factor", () =>
      AuthService.enableTwoFactor(code),
    );
    await useAuthStore.getState().refreshMe();
  },

  disableTwoFactor: async (password: string, code: string) => {
    await runAccountOperation(set, "disabling-two-factor", () =>
      AuthService.disableTwoFactor(password, code),
    );
    await useAuthStore.getState().refreshMe();
  },

  changePassword: (currentPassword: string, newPassword: string) =>
    runAccountOperation(set, "changing-password", () =>
      AuthService.changePassword(currentPassword, newPassword),
    ),

  updateProfile: async (firstName: string, lastName: string) => {
    const user = await runAccountOperation(set, "saving-profile", () =>
      AuthService.updateProfile(firstName, lastName),
    );
    set({ user, features: user.features ?? [] });
  },

  uploadProfileImage: async (file: File) => {
    const user = await runAccountOperation(set, "uploading-profile-image", () =>
      AuthService.uploadProfileImage(file),
    );
    set({ user, features: user.features ?? [] });
  },

  removeProfileImage: async () => {
    const user = await runAccountOperation(set, "removing-profile-image", () =>
      AuthService.removeProfileImage(),
    );
    set({ user, features: user.features ?? [] });
  },

  loadOwnedTrees: () => AuthService.getOwnedTrees(),

  loadOwnershipTransferTargets: (treeId: string) =>
    AuthService.getOwnershipTransferTargets(treeId),

  transferTreeOwnership: (treeId: string, username: string) =>
    runAccountOperation(set, "deleting-account", () =>
      AuthService.transferOwnership(treeId, username),
    ),

  register: async (
    username: string,
    password: string,
    email: string | null,
  ) => {
    const res = await api.post<TokenResponse>("/auth/register", {
      username,
      password,
      email,
    });
    applyToken(res);
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

async function runAccountOperation<T>(
  set: (partial: Partial<AuthState>) => void,
  operation: Exclude<AccountOperation, "idle">,
  action: () => Promise<T>,
): Promise<T> {
  set({ accountOperation: operation, accountError: null });
  try {
    return await action();
  } catch (error) {
    const accountError =
      error instanceof Error ? error.message : "Unknown error";
    set({ accountError });
    throw error;
  } finally {
    set({ accountOperation: "idle" });
  }
}

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
