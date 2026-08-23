/**
 * Unit tests for the presence heartbeat manager.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendPresence = vi.fn();
const leavePresence = vi.fn();
vi.mock("@/services/WorkspaceService", () => ({
  WorkspaceService: { sendPresence, leavePresence },
}));

const setRoster = vi.fn();
const clear = vi.fn();
vi.mock("@/hooks/usePresenceStore", () => ({
  usePresenceStore: { getState: () => ({ setRoster, clear }) },
}));

const loadTrees = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useWorkspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ loadTrees }) },
}));

/** Flush pending microtasks (the async heartbeat) under fake timers. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("presence heartbeat manager", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    sendPresence.mockResolvedValue({ workspace_id: "t1", users: [] });
    leavePresence.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends an immediate heartbeat and stores the returned roster", async () => {
    const users = [
      { user_id: "u2", display_name: "Anna", editing_member_id: null },
    ];
    sendPresence.mockResolvedValue({ workspace_id: "t1", users });

    const { startPresence } = await import("./presence");
    startPresence("t1");
    await flush();

    expect(sendPresence).toHaveBeenCalledWith(
      "t1",
      null,
      expect.any(AbortSignal),
    );
    expect(setRoster).toHaveBeenCalledWith("t1", users);
  });

  it("keeps heartbeating on the interval", async () => {
    const { startPresence } = await import("./presence");
    startPresence("t1");
    await flush();
    expect(sendPresence).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendPresence).toHaveBeenCalledTimes(2);
  });

  it("is idempotent for the same tree", async () => {
    const { startPresence } = await import("./presence");
    startPresence("t1");
    startPresence("t1");
    await flush();
    expect(sendPresence).toHaveBeenCalledTimes(1);
  });

  it("reports the edited member on the next heartbeat", async () => {
    const mod = await import("./presence");
    mod.startPresence("t1");
    await flush();

    mod.setEditingMember("m9");
    await flush();

    expect(sendPresence).toHaveBeenLastCalledWith(
      "t1",
      "m9",
      expect.any(AbortSignal),
    );
  });

  it("stopPresence clears local state and leaves the tree", async () => {
    const mod = await import("./presence");
    mod.startPresence("t1");
    await flush();

    mod.stopPresence();
    expect(clear).toHaveBeenCalled();
    expect(leavePresence).toHaveBeenCalledWith("t1");
  });

  it("switching workspaces leaves the old one and joins the new", async () => {
    const mod = await import("./presence");
    mod.startPresence("t1");
    await flush();

    mod.startPresence("t2");
    await flush();

    expect(leavePresence).toHaveBeenCalledWith("t1");
    expect(sendPresence).toHaveBeenLastCalledWith(
      "t2",
      null,
      expect.any(AbortSignal),
    );
  });

  it("replays an edit-target change that lands during a heartbeat", async () => {
    const deferred: {
      resolve?: (value: { workspace_id: string; users: [] }) => void;
    } = {};
    sendPresence
      .mockImplementationOnce(
        () =>
          new Promise<{ workspace_id: string; users: [] }>((resolve) => {
            deferred.resolve = resolve;
          }),
      )
      .mockResolvedValue({ workspace_id: "t1", users: [] });

    const mod = await import("./presence");
    mod.startPresence("t1");
    mod.setEditingMember("m9");

    expect(sendPresence).toHaveBeenCalledTimes(1);
    expect(deferred.resolve).toBeDefined();
    deferred.resolve?.({ workspace_id: "t1", users: [] });
    await flush();

    expect(sendPresence).toHaveBeenLastCalledWith(
      "t1",
      "m9",
      expect.any(AbortSignal),
    );
  });

  it("joins the next tree without waiting for an old request to finish", async () => {
    sendPresence.mockImplementationOnce(() => new Promise(() => undefined));

    const mod = await import("./presence");
    mod.startPresence("t1");
    mod.startPresence("t2");
    await flush();

    expect(sendPresence).toHaveBeenNthCalledWith(
      1,
      "t1",
      null,
      expect.any(AbortSignal),
    );
    expect(sendPresence).toHaveBeenNthCalledWith(
      2,
      "t2",
      null,
      expect.any(AbortSignal),
    );
  });

  it("stops heartbeating when the feature is disabled (404)", async () => {
    // Import ApiError from the same fresh module graph presence.ts uses, so the
    // `instanceof` check in the 404 handler matches (resetModules recreates it).
    const { ApiError } = await import("@/services/api");
    sendPresence.mockRejectedValue(new ApiError(404, "Not found"));

    const mod = await import("./presence");
    mod.startPresence("t1");
    await flush();

    // The 404 handler tears down the loop.
    expect(clear).toHaveBeenCalled();
    expect(leavePresence).toHaveBeenCalledWith("t1");

    sendPresence.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendPresence).not.toHaveBeenCalled();
  });

  it("stops heartbeating and reloads workspaces when access is revoked (403) (#814)", async () => {
    const { ApiError } = await import("@/services/api");
    sendPresence.mockRejectedValue(new ApiError(403, "No access to this tree"));

    const mod = await import("./presence");
    mod.startPresence("t1");
    await flush();

    // The 403 handler tears down the loop (roster cleared → stale presence
    // chips disappear) and nudges the tree store to notice the lost access.
    expect(clear).toHaveBeenCalled();
    expect(leavePresence).toHaveBeenCalledWith("t1");
    expect(loadTrees).toHaveBeenCalled();

    sendPresence.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendPresence).not.toHaveBeenCalled();
  });
});
