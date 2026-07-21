import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useNotificationStore,
  useUnreadNotificationCount,
} from "./useNotificationStore";
import { NotificationService } from "@/services/NotificationService";
import { NotificationDB } from "@/types/notification";

vi.mock("@/services/NotificationService");

const N1: NotificationDB = {
  id: "n1",
  type: "friend_request_received",
  payload: { requester_id: "u1", requester_username: "alice" },
  created_at: "2026-07-20T10:00:00Z",
  read_at: null,
};

const N2: NotificationDB = {
  id: "n2",
  type: "tree_shared",
  payload: { tree_id: "t1", tree_name: "Tree", role: "viewer", actor_username: "bob" },
  created_at: "2026-07-19T10:00:00Z",
  read_at: "2026-07-19T11:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationStore.setState({
    notifications: [],
    unreadCount: 0,
    loading: false,
    loaded: false,
  });
});

describe("useNotificationStore — load", () => {
  it("populates notifications and unreadCount from the first page", async () => {
    vi.mocked(NotificationService.list).mockResolvedValue({
      entries: [N1, N2],
      total: 2,
      unread_count: 1,
    });

    await useNotificationStore.getState().load();

    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([N1, N2]);
    expect(state.unreadCount).toBe(1);
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);

    const { result } = renderHook(() => useUnreadNotificationCount());
    expect(result.current).toBe(1);
  });
});

describe("useNotificationStore — refreshUnreadCount", () => {
  it("fetches just the unread count", async () => {
    vi.mocked(NotificationService.unreadCount).mockResolvedValue({
      unread_count: 4,
    });

    await useNotificationStore.getState().refreshUnreadCount();

    expect(useNotificationStore.getState().unreadCount).toBe(4);
  });
});

describe("useNotificationStore — addFromEvent", () => {
  it("prepends a new notification and increments unreadCount", () => {
    useNotificationStore.setState({ notifications: [N2], unreadCount: 0 });

    useNotificationStore.getState().addFromEvent(N1);

    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([N1, N2]);
    expect(state.unreadCount).toBe(1);
  });

  it("does not increment unreadCount for an already-read event", () => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });

    useNotificationStore.getState().addFromEvent(N2);

    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it("dedupes by id instead of adding a duplicate", () => {
    useNotificationStore.setState({ notifications: [N1], unreadCount: 1 });

    useNotificationStore.getState().addFromEvent(N1);

    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([N1]);
    expect(state.unreadCount).toBe(1);
  });
});

describe("useNotificationStore — markRead", () => {
  it("optimistically sets read_at and decrements unreadCount", async () => {
    useNotificationStore.setState({ notifications: [N1], unreadCount: 1 });
    vi.mocked(NotificationService.markRead).mockResolvedValue(undefined);

    await useNotificationStore.getState().markRead("n1");

    const state = useNotificationStore.getState();
    expect(state.unreadCount).toBe(0);
    expect(state.notifications[0].read_at).not.toBeNull();
    expect(NotificationService.markRead).toHaveBeenCalledWith("n1");
  });

  it("does not go below zero or double-decrement an already-read row", async () => {
    useNotificationStore.setState({ notifications: [N2], unreadCount: 0 });
    vi.mocked(NotificationService.markRead).mockResolvedValue(undefined);

    await useNotificationStore.getState().markRead("n2");

    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});

describe("useNotificationStore — markAllRead", () => {
  it("zeroes unreadCount and sets read_at on every row", async () => {
    useNotificationStore.setState({ notifications: [N1, N2], unreadCount: 1 });
    vi.mocked(NotificationService.markAllRead).mockResolvedValue(undefined);

    await useNotificationStore.getState().markAllRead();

    const state = useNotificationStore.getState();
    expect(state.unreadCount).toBe(0);
    expect(state.notifications.every((n) => n.read_at !== null)).toBe(true);
    expect(NotificationService.markAllRead).toHaveBeenCalled();
  });
});

describe("useNotificationStore — clear", () => {
  it("resets to the empty state", () => {
    useNotificationStore.setState({
      notifications: [N1],
      unreadCount: 1,
      loaded: true,
    });

    useNotificationStore.getState().clear();

    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(0);
    expect(state.loaded).toBe(false);
  });
});
