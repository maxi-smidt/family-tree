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
    total: 0,
    loading: false,
    loadingMore: false,
    loaded: false,
  });
});

describe("useNotificationStore — load", () => {
  it("populates notifications, unreadCount, and total from the first page", async () => {
    vi.mocked(NotificationService.list).mockResolvedValue({
      entries: [N1, N2],
      total: 2,
      unread_count: 1,
    });

    await useNotificationStore.getState().load();

    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([N1, N2]);
    expect(state.unreadCount).toBe(1);
    expect(state.total).toBe(2);
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);

    const { result } = renderHook(() => useUnreadNotificationCount());
    expect(result.current).toBe(1);
  });
});

describe("useNotificationStore — loadMore", () => {
  it("appends the next page, paging by the current list length", async () => {
    useNotificationStore.setState({ notifications: [N1], unreadCount: 1, total: 2 });
    vi.mocked(NotificationService.list).mockResolvedValue({
      entries: [N2],
      total: 2,
      unread_count: 1,
    });

    await useNotificationStore.getState().loadMore();

    expect(NotificationService.list).toHaveBeenCalledWith(25, 1);
    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([N1, N2]);
    expect(state.loadingMore).toBe(false);
  });

  it("dedupes entries already present (e.g. an SSE arrival mid-page)", async () => {
    useNotificationStore.setState({ notifications: [N1], unreadCount: 1, total: 2 });
    vi.mocked(NotificationService.list).mockResolvedValue({
      entries: [N1, N2],
      total: 2,
      unread_count: 1,
    });

    await useNotificationStore.getState().loadMore();

    expect(useNotificationStore.getState().notifications).toEqual([N1, N2]);
  });

  it("does nothing once every notification is already loaded", async () => {
    useNotificationStore.setState({ notifications: [N1, N2], unreadCount: 0, total: 2 });

    await useNotificationStore.getState().loadMore();

    expect(NotificationService.list).not.toHaveBeenCalled();
  });

  it("never lets a stale response overwrite unreadCount, and never lowers total", async () => {
    // Simulates a notification.created SSE event landing while the
    // loadMore request (issued before it) is still in flight: the response
    // reflects the pre-event world and must not undo the event's bump.
    useNotificationStore.setState({ notifications: [N1], unreadCount: 1, total: 2 });
    vi.mocked(NotificationService.list).mockResolvedValue({
      entries: [N2],
      total: 2, // stale — an event already bumped the live total to 3
      unread_count: 1, // stale — an event already bumped the live count to 2
    });

    const pending = useNotificationStore.getState().loadMore();
    useNotificationStore.getState().addFromEvent({
      id: "n3",
      type: "friend_request_received",
      payload: null,
      created_at: "2026-07-21T10:00:00Z",
      read_at: null,
    });
    await pending;

    const state = useNotificationStore.getState();
    expect(state.unreadCount).toBe(2);
    expect(state.total).toBe(3);
  });
});

describe("useNotificationStore — addFromEvent", () => {
  it("prepends a new notification, increments unreadCount and total", () => {
    useNotificationStore.setState({ notifications: [N2], unreadCount: 0, total: 1 });

    useNotificationStore.getState().addFromEvent(N1);

    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([N1, N2]);
    expect(state.unreadCount).toBe(1);
    expect(state.total).toBe(2);
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
      total: 1,
      loaded: true,
    });

    useNotificationStore.getState().clear();

    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(0);
    expect(state.total).toBe(0);
    expect(state.loaded).toBe(false);
  });
});
