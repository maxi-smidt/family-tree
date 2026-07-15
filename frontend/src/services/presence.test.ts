/**
 * Unit tests for the presence heartbeat manager.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendPresence = vi.fn();
const leavePresence = vi.fn();
vi.mock("@/services/TreeService", () => ({
  TreeService: { sendPresence, leavePresence },
}));

const setRoster = vi.fn();
const clear = vi.fn();
vi.mock("@/hooks/usePresenceStore", () => ({
  usePresenceStore: { getState: () => ({ setRoster, clear }) },
}));

/** Flush pending microtasks (the async heartbeat) under fake timers. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("presence heartbeat manager", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    sendPresence.mockResolvedValue({ tree_id: "t1", users: [] });
    leavePresence.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends an immediate heartbeat and stores the returned roster", async () => {
    const users = [
      { user_id: "u2", display_name: "Anna", editing_member_id: null },
    ];
    sendPresence.mockResolvedValue({ tree_id: "t1", users });

    const { startPresence } = await import("./presence");
    startPresence("t1");
    await flush();

    expect(sendPresence).toHaveBeenCalledWith("t1", null);
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

    expect(sendPresence).toHaveBeenLastCalledWith("t1", "m9");
  });

  it("stopPresence clears local state and leaves the tree", async () => {
    const mod = await import("./presence");
    mod.startPresence("t1");
    await flush();

    mod.stopPresence();
    expect(clear).toHaveBeenCalled();
    expect(leavePresence).toHaveBeenCalledWith("t1");
  });

  it("switching trees leaves the old one and joins the new", async () => {
    const mod = await import("./presence");
    mod.startPresence("t1");
    await flush();

    mod.startPresence("t2");
    await flush();

    expect(leavePresence).toHaveBeenCalledWith("t1");
    expect(sendPresence).toHaveBeenLastCalledWith("t2", null);
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
});
