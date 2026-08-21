import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onUnauthorized, PUBLIC_PASSWORD_REQUIRED } from "./api";

describe("api — postForm timeout", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("aborts a hung connection once the timeout elapses instead of hanging forever", async () => {
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const assertion = expect(
      api.postForm("/trees/t1/documents/uploads", new FormData(), 1000),
    ).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("does not abort a request that resolves before the timeout", async () => {
    globalThis.fetch = vi.fn(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "upload-1" }), { status: 201 }),
        ) as ReturnType<typeof fetch>,
    );

    const result = await api.postForm(
      "/trees/t1/documents/uploads",
      new FormData(),
      1000,
    );

    expect(result).toEqual({ id: "upload-1" });
  });
});

describe("api — get timeout", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("aborts a stalled GET once the timeout elapses instead of hanging forever", async () => {
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const assertion = expect(
      api.get("/auth/me", undefined, 1000),
    ).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});

describe("api — 401 classification", () => {
  const originalFetch = globalThis.fetch;
  let unauthorizedHandler: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    unauthorizedHandler = vi.fn<() => void>();
    onUnauthorized(unauthorizedHandler);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes a semantic 401 (public_password_required) to its error without invalidating the session", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: PUBLIC_PASSWORD_REQUIRED }), {
          status: 401,
        }),
      ),
    ) as unknown as typeof fetch;

    const error = await api
      .get("/trees/public-tree-1")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(PUBLIC_PASSWORD_REQUIRED);
    expect(unauthorizedHandler).not.toHaveBeenCalled();
  });

  it("invokes the unauthorized handler for a genuine invalid/expired token 401", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Invalid token" }), {
          status: 401,
        }),
      ),
    ) as unknown as typeof fetch;

    const error = await api.get("/auth/me").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(unauthorizedHandler).toHaveBeenCalledTimes(1);
  });
});
