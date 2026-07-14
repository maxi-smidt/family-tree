import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenResponse, User } from "@/types/user";

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  get: vi.fn(),
  post: vi.fn(),
  unauthorizedHandler: null as (() => void) | null,
}));

vi.mock("@/services/api", () => ({
  api: {
    get: mocks.get,
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
    mocks.get.mockReset();
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

describe("useAuthStore account workflows", () => {
  beforeEach(() => {
    mocks.token = "current-token";
    mocks.get.mockReset();
    mocks.post.mockReset();
    useAuthStore.setState({
      status: "authenticated",
      user: USER,
      features: [],
      accountOperation: "idle",
      accountError: null,
    });
  });

  afterEach(() => {
    useAuthStore.getState().logout();
  });

  it("routes two-factor setup through the store and clears its loading state", async () => {
    mocks.post.mockResolvedValue({
      secret: "secret",
      otpauth_url: "otpauth://example",
      recovery_codes: ["code"],
    });
    mocks.get.mockResolvedValue({ data_url: "data:image/png;base64,qr" });

    await expect(useAuthStore.getState().setupTwoFactor()).resolves.toEqual({
      setup: expect.objectContaining({ secret: "secret" }),
      qrDataUrl: "data:image/png;base64,qr",
    });
    expect(mocks.post).toHaveBeenCalledWith("/auth/2fa/setup");
    expect(mocks.get).toHaveBeenCalledWith("/auth/2fa/qr-code");
    expect(useAuthStore.getState()).toMatchObject({
      accountOperation: "idle",
      accountError: null,
    });
  });

  it("keeps account-operation failures in store state", async () => {
    mocks.post.mockRejectedValue(new Error("Incorrect password"));

    await expect(
      useAuthStore.getState().changePassword("old", "new"),
    ).rejects.toThrow("Incorrect password");
    expect(mocks.post).toHaveBeenCalledWith("/auth/password", {
      current_password: "old",
      new_password: "new",
    });
    expect(useAuthStore.getState()).toMatchObject({
      accountOperation: "idle",
      accountError: "Incorrect password",
    });
  });

  it("does not restore a user after the session changes during refresh", async () => {
    let resolveUser: (user: User) => void = () => undefined;
    mocks.get.mockReturnValue(
      new Promise<User>((resolve) => {
        resolveUser = resolve;
      }),
    );

    const refresh = useAuthStore.getState().refreshMe();
    useAuthStore.getState().logout();
    resolveUser(USER);
    await refresh;

    expect(useAuthStore.getState()).toMatchObject({
      status: "unauthenticated",
      user: null,
    });
  });
});
