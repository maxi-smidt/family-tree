import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  FRONTEND_SCHEMA_EPOCH,
  onSchemaEpochMismatch,
  onStartupInProgress,
  onUnauthorized,
  PUBLIC_PASSWORD_REQUIRED,
} from "./api";

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
      api.postForm("/workspaces/t1/documents/uploads", new FormData(), 1000),
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
      "/workspaces/t1/documents/uploads",
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
      .get("/workspaces/public-tree-1")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(PUBLIC_PASSWORD_REQUIRED);
    expect(unauthorizedHandler).not.toHaveBeenCalled();
  });

  it("routes a wrong public-tree password 401 (invalid_public_password) without invalidating the session", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "invalid_public_password" }), {
          status: 401,
        }),
      ),
    ) as unknown as typeof fetch;

    const error = await api
      .post("/workspaces/public-tree-1/public/unlock", { password: "wrong" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(unauthorizedHandler).not.toHaveBeenCalled();
  });

  it("routes a wrong import-file password 401 (Password required) without invalidating the session", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Password required" }), {
          status: 401,
        }),
      ),
    ) as unknown as typeof fetch;

    const error = await api
      .postForm("/workspaces/import", new FormData())
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
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

describe("api — schema epoch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends this build's schema epoch on every request", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await api.get("/auth/config");

    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>)["X-Schema-Epoch"]).toBe(
      String(FRONTEND_SCHEMA_EPOCH),
    );
  });

  it("invokes the schema-epoch-mismatch handler on a 409 schema_epoch_mismatch", async () => {
    const mismatchHandler = vi.fn<() => void>();
    onSchemaEpochMismatch(mismatchHandler);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "schema_epoch_mismatch" }), {
          status: 409,
        }),
      ),
    ) as unknown as typeof fetch;

    const error = await api.post("/workspaces").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(mismatchHandler).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the schema-epoch-mismatch handler for an unrelated 409", async () => {
    const mismatchHandler = vi.fn<() => void>();
    onSchemaEpochMismatch(mismatchHandler);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "some_other_conflict" }), {
          status: 409,
        }),
      ),
    ) as unknown as typeof fetch;

    await api.post("/workspaces").catch(() => undefined);

    expect(mismatchHandler).not.toHaveBeenCalled();
  });

  it("invokes the startup-in-progress handler on a 503 startup_in_progress", async () => {
    const startupHandler = vi.fn<() => void>();
    onStartupInProgress(startupHandler);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "startup_in_progress" }), {
          status: 503,
        }),
      ),
    ) as unknown as typeof fetch;

    const error = await api.get("/workspaces").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(startupHandler).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the startup-in-progress handler for an unrelated 503", async () => {
    const startupHandler = vi.fn<() => void>();
    onStartupInProgress(startupHandler);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "degraded" }), {
          status: 503,
        }),
      ),
    ) as unknown as typeof fetch;

    await api.get("/workspaces").catch(() => undefined);

    expect(startupHandler).not.toHaveBeenCalled();
  });
});
