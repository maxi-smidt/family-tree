/**
 * Unit tests for the realtime SSE client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake EventSource
// ---------------------------------------------------------------------------

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
  static instance: FakeEventSource | null = null;

  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private listeners: Map<string, Listener[]> = new Map();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instance = this;
  }

  addEventListener(type: string, fn: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, fn]);
  }

  /** Dispatch a named event to all registered listeners. */
  dispatch(type: string, data: unknown): void {
    const fns = this.listeners.get(type) ?? [];
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const fn of fns) fn(ev);
  }

  close(): void {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/services/api", () => ({
  api: {
    post: vi.fn().mockResolvedValue({ ticket: "test-sse-ticket" }),
  },
}));

vi.mock("@/hooks/useTreeStore", () => {
  const loadTrees = vi.fn().mockResolvedValue(undefined);
  return {
    useTreeStore: {
      getState: () => ({ loadTrees }),
    },
    isActiveTree: vi.fn(() => true),
  };
});

vi.mock("@/hooks/useJobStore", () => {
  const onProgress = vi.fn();
  const onDone = vi.fn();
  const onFailed = vi.fn();
  return {
    useJobStore: {
      getState: () => ({ onProgress, onDone, onFailed }),
    },
  };
});

vi.mock("@/hooks/useAuthStore", () => {
  const logout = vi.fn();
  return {
    useAuthStore: {
      getState: () => ({ logout }),
    },
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function waitForEventSource(): Promise<FakeEventSource> {
  await vi.waitFor(() => expect(FakeEventSource.instance).not.toBeNull());
  return FakeEventSource.instance!;
}

describe("realtime", () => {
  beforeEach(() => {
    // Install the fake EventSource globally before each test.
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instance = null;

    // Reset module state between tests by re-importing.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("startRealtime opens an EventSource with an SSE ticket in the URL", async () => {
    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();

    const eventSource = await waitForEventSource();
    expect(eventSource.url).toContain("/sse/events?ticket=");
    expect(eventSource.url).toContain("test-sse-ticket");

    stopRealtime();
  });

  it("dispatching tree.ownership_changed triggers loadTrees", async () => {
    const { useTreeStore } = await import("@/hooks/useTreeStore");
    const loadTrees = useTreeStore.getState().loadTrees;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("tree.ownership_changed", {
      tree_id: "t1",
    });

    expect(loadTrees).toHaveBeenCalled();
    stopRealtime();
  });

  it("dispatching tree.access_changed triggers loadTrees", async () => {
    const { useTreeStore } = await import("@/hooks/useTreeStore");
    const loadTrees = useTreeStore.getState().loadTrees;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("tree.access_changed", {
      tree_id: "t1",
    });

    expect(loadTrees).toHaveBeenCalled();
    stopRealtime();
  });

  it("dispatching tree.deleted triggers loadTrees", async () => {
    const { useTreeStore } = await import("@/hooks/useTreeStore");
    const loadTrees = useTreeStore.getState().loadTrees;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("tree.deleted", { tree_id: "t1" });

    expect(loadTrees).toHaveBeenCalled();
    stopRealtime();
  });

  it("stopRealtime closes the EventSource", async () => {
    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();

    const es = await waitForEventSource();
    stopRealtime();

    expect(es.closed).toBe(true);
  });

  it("dispatching session.invalidate logs out and closes the connection", async () => {
    const { useAuthStore } = await import("@/hooks/useAuthStore");
    const logout = useAuthStore.getState().logout;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    const es = await waitForEventSource();

    es.dispatch("session.invalidate", { reason: "deactivated" });

    expect(logout).toHaveBeenCalled();
    expect(es.closed).toBe(true);
    stopRealtime();
  });

  it("startRealtime is idempotent (does not open a second connection)", async () => {
    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    const first = await waitForEventSource();

    // Replace instance so we can detect if a new one is created.
    FakeEventSource.instance = null;
    startRealtime();

    expect(FakeEventSource.instance).toBeNull(); // no new connection
    stopRealtime();
    // Clean up first instance.
    first?.close();
  });

  it("dispatching job.progress calls onProgress with job_id and pct", async () => {
    const { useJobStore } = await import("@/hooks/useJobStore");
    const { onProgress } = useJobStore.getState();

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("job.progress", {
      job_id: "job-1",
      pct: 42,
    });

    expect(onProgress).toHaveBeenCalledWith("job-1", 42);
    stopRealtime();
  });

  it("dispatching job.done calls onDone with job_id and tree_id", async () => {
    const { useJobStore } = await import("@/hooks/useJobStore");
    const { onDone } = useJobStore.getState();

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("job.done", {
      job_id: "job-1",
      tree_id: "tree-42",
    });

    expect(onDone).toHaveBeenCalledWith("job-1", "tree-42");
    stopRealtime();
  });

  it("dispatching job.failed calls onFailed with job_id and error", async () => {
    const { useJobStore } = await import("@/hooks/useJobStore");
    const { onFailed } = useJobStore.getState();

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("job.failed", {
      job_id: "job-1",
      error: "quota exceeded",
    });

    expect(onFailed).toHaveBeenCalledWith("job-1", "quota exceeded");
    stopRealtime();
  });
});
