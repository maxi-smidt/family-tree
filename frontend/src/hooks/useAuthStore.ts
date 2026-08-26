import { create } from "zustand";
import {
  ApiError,
  api,
  FRONTEND_SCHEMA_EPOCH,
  getAuthToken,
  onSchemaEpochMismatch,
  onStartupInProgress,
  onUnauthorized,
  setAuthToken,
  STARTUP_IN_PROGRESS_DETAIL,
} from "@/services/api";
import { WorkspaceSharingService } from "@/services/WorkspaceSharingService";
import { AuthService, TwoFactorSetup } from "@/services/AuthService";
import { Workspace } from "@/types/workspace";
import { AuthConfig, LoginResponse, TokenResponse, User } from "@/types/user";
import { decodeJwtExp } from "@/lib/utils";

type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unreachable"
  | "upgrade-required"
  | "starting";
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
  config: AuthConfig | null;
  sessionExpiringSoon: boolean;
  sessionRefreshFailed: boolean;
  reloginRequired: boolean;
  /** Token stored from an #invite= URL hash; consumed after login/register. */
  pendingInviteToken: string | null;
  /** Workspace ID from a #public= URL hash; enables anonymous public tree viewing. */
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
  loadOwnedTrees: () => Promise<Workspace[]>;
  loadOwnershipTransferTargets: (
    workspaceId: string,
  ) => Promise<Array<{ user_id: string; username: string }>>;
  transferTreeOwnership: (workspaceId: string, username: string) => Promise<void>;
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
        status: "unauthenticated",
      });
      return;
    }
    if (
      error instanceof ApiError &&
      error.status === 503 &&
      error.message === STARTUP_IN_PROGRESS_DETAIL
    ) {
      // onStartupInProgress (registered below) already set status:
      // "starting" for the backend's own startup-migration gate — leave it
      // in place instead of falling through to the generic unreachable
      // retry screen. Any other 503 (e.g. a degraded-Redis /health/ready
      // response reaching some other caller) falls through below like any
      // other unreachable error.
      return;
    }
    useAuthStore.setState({ status: "unreachable" });
  }
}

function applyToken(res: TokenResponse) {
  setAuthToken(res.access_token);
  useAuthStore.setState({
    user: res.user,
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
      const workspaceId = decodeURIComponent(hash.slice("#public=".length));
      set({ pendingPublicTreeId: workspaceId });
      window.history.replaceState(null, "", window.location.pathname);
    }

    try {
      const config = await api.get<AuthConfig>(
        "/auth/config",
        undefined,
        AUTH_CHECK_TIMEOUT_MS,
      );
      set({ config });
      // A backend that reports a different epoch than this build never
      // shares its wire contract — stop before /auth/me instead of signing
      // the user in against routes/shapes it doesn't have. A backend that
      // omits the field entirely (predates #1012) is treated as unknown,
      // not a mismatch.
      if (
        config.schema_epoch !== undefined &&
        config.schema_epoch !== FRONTEND_SCHEMA_EPOCH
      ) {
        set({ status: "upgrade-required" });
        return;
      }
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
    set({ user });
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
    set({ user });
  },

  uploadProfileImage: async (file: File) => {
    const user = await runAccountOperation(set, "uploading-profile-image", () =>
      AuthService.uploadProfileImage(file),
    );
    set({ user });
  },

  removeProfileImage: async () => {
    const user = await runAccountOperation(set, "removing-profile-image", () =>
      AuthService.removeProfileImage(),
    );
    set({ user });
  },

  loadOwnedTrees: () => AuthService.getOwnedTrees(),

  loadOwnershipTransferTargets: (workspaceId: string) =>
    AuthService.getOwnershipTransferTargets(workspaceId),

  transferTreeOwnership: (workspaceId: string, username: string) =>
    runAccountOperation(set, "deleting-account", () =>
      AuthService.transferOwnership(workspaceId, username),
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
      const result = await WorkspaceSharingService.acceptInvite(pendingInviteToken);
      set({ pendingInviteToken: null });
      return result.workspace_id;
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

// A mid-session backend upgrade/rollback shows up as this instead of the
// init()-time check above — same terminal, non-retrying state either way.
onSchemaEpochMismatch(() => {
  useAuthStore.setState({ status: "upgrade-required" });
});

// Fires from any request while the backend's own startup migration is still
// running (#1020) — the session/token is left untouched, so once it
// finishes the next auth check (see MaintenanceScreen) picks up right where
// the user left off instead of forcing a fresh sign-in.
onStartupInProgress(() => {
  useAuthStore.setState({ status: "starting" });
});
