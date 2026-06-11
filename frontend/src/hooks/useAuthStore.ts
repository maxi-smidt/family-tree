import { create } from "zustand";
import { api, getAuthToken, onUnauthorized, setAuthToken } from "@/services/api";
import { AuthConfig, TokenResponse, User } from "@/types/user";
import { decodeJwtExp } from "@/lib/utils";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  config: AuthConfig | null;
  sessionExpiringSoon: boolean;
  reloginRequired: boolean;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  deleteAccount: (
    password: string | null,
    confirmUsername: string | null,
  ) => Promise<User>;
  restoreAccount: (username: string, password: string) => Promise<void>;
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

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  config: null,
  sessionExpiringSoon: false,
  reloginRequired: false,

  init: async () => {
    // Pick up a token handed back by the Authentik OAuth redirect (#token=...).
    const hash = window.location.hash;
    if (hash.startsWith("#token=")) {
      const token = decodeURIComponent(hash.slice("#token=".length));
      setAuthToken(token);
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
      set({ user, status: "authenticated" });
      startExpiryCheck();
    } catch {
      setAuthToken(null);
      set({ user: null, status: "unauthenticated" });
    }
  },

  login: async (username: string, password: string) => {
    const res = await api.post<TokenResponse>("/auth/login", {
      username,
      password,
    });
    setAuthToken(res.access_token);
    set({
      user: res.user,
      status: "authenticated",
      reloginRequired: false,
      sessionExpiringSoon: false,
    });
    startExpiryCheck();
  },

  logout: () => {
    if (expiryCheckInterval) {
      clearInterval(expiryCheckInterval);
      expiryCheckInterval = null;
    }
    setAuthToken(null);
    set({
      user: null,
      status: "unauthenticated",
      sessionExpiringSoon: false,
      reloginRequired: false,
    });
  },

  refreshMe: async () => {
    const user = await api.get<User>("/auth/me");
    set({ user });
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
    setAuthToken(res.access_token);
    set({
      user: res.user,
      status: "authenticated",
      reloginRequired: false,
      sessionExpiringSoon: false,
    });
    startExpiryCheck();
  },
}));

// Any 401 from the API triggers a relogin dialog instead of a hard logout,
// so the user can re-authenticate in-place without losing UI state.
onUnauthorized(() => {
  const { status } = useAuthStore.getState();
  if (status === "authenticated") {
    useAuthStore.setState({ reloginRequired: true });
  }
});
