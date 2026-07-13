import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenResponse, User } from "@/types/user";

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  post: vi.fn(),
  unauthorizedHandler: null as (() => void) | null,
}));

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: mocks.post,
  },
  getAuthToken: () => mocks.token,
  setAuthToken: (token: string | null) => {
    mocks.token = token;
  },
  onUnauthorized: (handler: () => void) => {
    mocks.unauthorizedHandler = handler;
  },
}));

import { useAuthStore } from "./useAuthStore";

const USER: User = {
  id: "user-1",
  username: "alice",
  email: null,
  full_name: null,
  is_admin: false,
  is_active: true,
  auth_provider: "local",
  created_at: "2026-01-01T00:00:00Z",
};

const REFRESHED_SESSION: TokenResponse = {
  access_token: "refreshed-token",
  token_type: "bearer",
  user: USER,
};

describe("useAuthStore session refresh", () => {
  beforeEach(() => {
    mocks.token = "current-token";
    mocks.post.mockReset();
    useAuthStore.setState({
      status: "authenticated",
      user: USER,
      features: [],
      sessionExpiringSoon: true,
      sessionRefreshFailed: true,
      reloginRequired: false,
    });
  });

  afterEach(() => {
    useAuthStore.getState().logout();
  });

  it("replaces the token and clears the expiry state after a successful refresh", async () => {
    mocks.post.mockResolvedValue(REFRESHED_SESSION);

    await useAuthStore.getState().refreshSession();

    expect(mocks.post).toHaveBeenCalledWith("/auth/refresh");
    expect(mocks.token).toBe("refreshed-token");
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      user: USER,
      sessionExpiringSoon: false,
      sessionRefreshFailed: false,
      reloginRequired: false,
    });
  });

  it("keeps the current session visible and offers re-login when refresh fails", async () => {
    mocks.post.mockRejectedValue(new Error("offline"));

    await useAuthStore.getState().refreshSession();

    expect(mocks.token).toBe("current-token");
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      sessionExpiringSoon: true,
      sessionRefreshFailed: true,
      reloginRequired: false,
    });
  });
});
