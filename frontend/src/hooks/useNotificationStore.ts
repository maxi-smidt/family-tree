import { create } from "zustand";
import { NotificationService } from "@/services/NotificationService";
import { NotificationDB } from "@/types/notification";

const PAGE_SIZE = 25;

interface NotificationState {
  notifications: NotificationDB[];
  unreadCount: number;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
  /** Fetch the first page of notifications + the unread count. */
  load: () => Promise<void>;
  /** Fetch the next page and append it (paging by current list length). */
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Prepend a notification pushed live over SSE. */
  addFromEvent: (n: NotificationDB) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  total: 0,
  loading: false,
  loadingMore: false,
  loaded: false,

  load: async () => {
    set({ loading: true });
    try {
      const page = await NotificationService.list(PAGE_SIZE);
      set({
        notifications: page.entries,
        unreadCount: page.unread_count,
        total: page.total,
        loaded: true,
      });
    } finally {
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { loadingMore, notifications, total } = get();
    if (loadingMore || notifications.length >= total) return;
    set({ loadingMore: true });
    try {
      const page = await NotificationService.list(PAGE_SIZE, notifications.length);
      set((state) => {
        const existingIds = new Set(state.notifications.map((n) => n.id));
        const newEntries = page.entries.filter((n) => !existingIds.has(n.id));
        return {
          notifications: [...state.notifications, ...newEntries],
          // Not unreadCount: a live SSE notification.created may have landed
          // (and already bumped it) while this request was in flight — this
          // response was snapshotted before that, so it must never clobber a
          // newer value. total is monotonic here for the same reason (it only
          // ever grows from addFromEvent), so max is always the fresher count.
          total: Math.max(state.total, page.total),
        };
      });
    } finally {
      set({ loadingMore: false });
    }
  },

  markRead: async (id) => {
    const target = get().notifications.find((n) => n.id === id);
    if (target && target.read_at === null) {
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
    }
    await NotificationService.markRead(id);
  },

  markAllRead: async () => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.read_at === null ? { ...n, read_at: new Date().toISOString() } : n,
      ),
      unreadCount: 0,
    }));
    await NotificationService.markAllRead();
  },

  addFromEvent: (n) => {
    set((state) => {
      if (state.notifications.some((existing) => existing.id === n.id)) {
        return state;
      }
      return {
        notifications: [n, ...state.notifications],
        unreadCount:
          n.read_at === null ? state.unreadCount + 1 : state.unreadCount,
        total: state.total + 1,
      };
    });
  },

  clear: () =>
    set({
      notifications: [],
      unreadCount: 0,
      total: 0,
      loading: false,
      loadingMore: false,
      loaded: false,
    }),
}));

/** Reactive selector for the bell's unread badge count. */
export const useUnreadNotificationCount = (): number =>
  useNotificationStore((s) => s.unreadCount);

/** Reset on login/logout so a new session never sees the previous user's data. */
export const resetNotificationStoreForSession = () =>
  useNotificationStore.getState().clear();
