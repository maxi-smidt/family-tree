import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenResponse, User } from "@/types/user";
import { ApiError } from "@/services/api";

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    token: null as string | null,
    get: vi.fn(),
    post: vi.fn(),
    unauthorizedHandler: null as (() => void) | null,
    ApiError: MockApiError,
  };
});

vi.mock("@/services/api", () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
  },
  ApiError: mocks.ApiError,
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

describe("useAuthStore init", () => {
  beforeEach(() => {
    mocks.token = "current-token";
    mocks.get.mockReset();
    mocks.post.mockReset();
    useAuthStore.setState({ status: "loading", user: null, features: [] });
  });

  afterEach(() => {
    useAuthStore.getState().logout();
  });

  it("authenticates on a successful /auth/me check", async () => {
    mocks.get.mockResolvedValue(USER);

    await useAuthStore.getState().init();

    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      user: USER,
    });
    expect(mocks.token).toBe("current-token");
  });

  it("clears the token and logs out on a definitive 401", async () => {
    mocks.get.mockRejectedValue(new ApiError(401, "Invalid token"));

    await useAuthStore.getState().init();

    expect(mocks.token).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({
      status: "unauthenticated",
      user: null,
    });
  });

  it("retains the token and exposes a retryable state on a 500", async () => {
    mocks.get.mockRejectedValue(new ApiError(500, "Internal error"));

    await useAuthStore.getState().init();

    expect(mocks.token).toBe("current-token");
    expect(useAuthStore.getState().status).toBe("unreachable");
  });

  it("retains the token and exposes a retryable state on a network error", async () => {
    mocks.get.mockRejectedValue(new TypeError("Failed to fetch"));

    await useAuthStore.getState().init();

    expect(mocks.token).toBe("current-token");
    expect(useAuthStore.getState().status).toBe("unreachable");
  });

  it("retains the token and exposes a retryable state on a timeout", async () => {
    mocks.get.mockRejectedValue(new DOMException("Timeout", "AbortError"));

    await useAuthStore.getState().init();

    expect(mocks.token).toBe("current-token");
    expect(useAuthStore.getState().status).toBe("unreachable");
  });

  it("bounds the startup /auth/config and /auth/me requests with a timeout", async () => {
    mocks.get.mockResolvedValue(USER);

    await useAuthStore.getState().init();

    for (const call of mocks.get.mock.calls) {
      const [, , timeoutMs] = call;
      expect(typeof timeoutMs).toBe("number");
      expect(timeoutMs).toBeGreaterThan(0);
    }
  });

  it("resumes the session on a successful retry after a transient failure", async () => {
    mocks.get.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().status).toBe("unreachable");

    mocks.get.mockResolvedValueOnce(USER);
    await useAuthStore.getState().retryAuthCheck();

    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      user: USER,
    });
    expect(mocks.token).toBe("current-token");
  });
});
