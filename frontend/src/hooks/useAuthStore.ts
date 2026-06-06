import { create } from "zustand";
import { api, onUnauthorized, setAuthToken } from "@/services/api";
import { AuthConfig, TokenResponse, User } from "@/types/user";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  config: AuthConfig | null;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  config: null,

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
    set({ user: res.user, status: "authenticated" });
  },

  logout: () => {
    setAuthToken(null);
    set({ user: null, status: "unauthenticated" });
  },

  refreshMe: async () => {
    const user = await api.get<User>("/auth/me");
    set({ user });
  },
}));

// Any 401 from the API drops the session back to the login screen.
onUnauthorized(() => {
  const { status, logout } = useAuthStore.getState();
  if (status === "authenticated") logout();
});
