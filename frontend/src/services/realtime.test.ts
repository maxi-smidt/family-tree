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

vi.mock("@/hooks/useWorkspaceStore", () => {
  const loadTrees = vi.fn().mockResolvedValue(undefined);
  const state: { selectedTree?: { id: string; name: string } } = {};
  return {
    useWorkspaceStore: {
      getState: () => ({
        loadTrees,
        selectedTree: state.selectedTree,
      }),
      // Test-only handle to mutate the fake selection between events.
      __state: state,
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

vi.mock("@/hooks/usePresenceStore", () => {
  const setRoster = vi.fn();
  const markActivity = vi.fn();
  return {
    usePresenceStore: { getState: () => ({ setRoster, markActivity }) },
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

  it("dispatching workspace.ownership_changed triggers loadTrees", async () => {
    const { useWorkspaceStore } = await import("@/hooks/useWorkspaceStore");
    const loadTrees = useWorkspaceStore.getState().loadTrees;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("workspace.ownership_changed", {
      workspace_id: "t1",
    });

    expect(loadTrees).toHaveBeenCalled();
    stopRealtime();
  });

  it("dispatching workspace.access_changed triggers loadTrees", async () => {
    const { useWorkspaceStore } = await import("@/hooks/useWorkspaceStore");
    const loadTrees = useWorkspaceStore.getState().loadTrees;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("workspace.access_changed", {
      workspace_id: "t1",
    });

    expect(loadTrees).toHaveBeenCalled();
    stopRealtime();
  });

  it("dispatching workspace.deleted triggers loadTrees", async () => {
    const { useWorkspaceStore } = await import("@/hooks/useWorkspaceStore");
    const loadTrees = useWorkspaceStore.getState().loadTrees;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("workspace.deleted", { workspace_id: "t1" });

    expect(loadTrees).toHaveBeenCalled();
    stopRealtime();
  });

  it("toasts when the active tree disappears after workspace.access_changed (#814)", async () => {
    const { useWorkspaceStore } = await import("@/hooks/useWorkspaceStore");
    const { toast } = await import("sonner");
    const state = (
      useWorkspaceStore as unknown as {
        __state: { selectedTree?: { id: string; name: string } };
      }
    ).__state;
    state.selectedTree = { id: "t1", name: "Family" };
    // loadTrees drops the stale selection (access revoked server-side).
    vi.mocked(useWorkspaceStore.getState().loadTrees).mockImplementationOnce(
      async () => {
        state.selectedTree = undefined;
      },
    );

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("workspace.access_changed", {
      workspace_id: "t1",
    });

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    stopRealtime();
  });

  it("does not toast when the active tree survives workspace.access_changed", async () => {
    const { useWorkspaceStore } = await import("@/hooks/useWorkspaceStore");
    const { toast } = await import("sonner");
    const state = (
      useWorkspaceStore as unknown as {
        __state: { selectedTree?: { id: string; name: string } };
      }
    ).__state;
    state.selectedTree = { id: "t1", name: "Family" };

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    // Someone else's membership changed — our tree is unaffected.
    FakeEventSource.instance!.dispatch("workspace.access_changed", {
      workspace_id: "t1",
    });

    await vi.waitFor(() =>
      expect(useWorkspaceStore.getState().loadTrees).toHaveBeenCalled(),
    );
    // Give the async reload a chance to (not) toast.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toast.error).not.toHaveBeenCalled();
    stopRealtime();
  });

  it("highlights the actor when a tree mutation arrives", async () => {
    const { usePresenceStore } = await import("@/hooks/usePresenceStore");
    const markActivity = usePresenceStore.getState().markActivity;
    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("workspace.content_changed", {
      workspace_id: "t1",
      domain: "unknown",
      actor_user_id: "editor-1",
    });

    expect(markActivity).toHaveBeenCalledWith("editor-1");
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

  it("dispatching job.done calls onDone with job_id and workspace_id", async () => {
    const { useJobStore } = await import("@/hooks/useJobStore");
    const { onDone } = useJobStore.getState();

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    await waitForEventSource();

    FakeEventSource.instance!.dispatch("job.done", {
      job_id: "job-1",
      workspace_id: "tree-42",
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
