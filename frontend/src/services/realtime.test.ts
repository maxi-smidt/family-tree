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
  getAuthToken: vi.fn(() => "test-token"),
}));

vi.mock("@/hooks/useTreeStore", () => {
  const loadTrees = vi.fn().mockResolvedValue(undefined);
  return {
    useTreeStore: {
      getState: () => ({ loadTrees }),
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  it("startRealtime opens an EventSource with the token in the URL", async () => {
    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();

    expect(FakeEventSource.instance).not.toBeNull();
    expect(FakeEventSource.instance!.url).toContain("/sse/events?token=");
    expect(FakeEventSource.instance!.url).toContain("test-token");

    stopRealtime();
  });

  it("dispatching tree.ownership_changed triggers loadTrees", async () => {
    const { useTreeStore } = await import("@/hooks/useTreeStore");
    const loadTrees = useTreeStore.getState().loadTrees;

    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();

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

    FakeEventSource.instance!.dispatch("tree.deleted", { tree_id: "t1" });

    expect(loadTrees).toHaveBeenCalled();
    stopRealtime();
  });

  it("stopRealtime closes the EventSource", async () => {
    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();

    const es = FakeEventSource.instance!;
    stopRealtime();

    expect(es.closed).toBe(true);
  });

  it("startRealtime is idempotent (does not open a second connection)", async () => {
    const { startRealtime, stopRealtime } = await import("./realtime");
    startRealtime();
    const first = FakeEventSource.instance;

    // Replace instance so we can detect if a new one is created.
    FakeEventSource.instance = null;
    startRealtime();

    expect(FakeEventSource.instance).toBeNull(); // no new connection
    stopRealtime();
    // Clean up first instance.
    first?.close();
  });
});
