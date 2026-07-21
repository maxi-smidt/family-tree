import { create } from "zustand";
import { NotificationService } from "@/services/NotificationService";
import { NotificationDB } from "@/types/notification";

const PAGE_SIZE = 25;

interface NotificationState {
  notifications: NotificationDB[];
  unreadCount: number;
  loading: boolean;
  loaded: boolean;
  /** Fetch the first page of notifications + the unread count. */
  load: () => Promise<void>;
  /** Lightweight refresh of just the unread count (for the badge). */
  refreshUnreadCount: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Prepend a notification pushed live over SSE. */
  addFromEvent: (n: NotificationDB) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  loaded: false,

  load: async () => {
    set({ loading: true });
    try {
      const page = await NotificationService.list(PAGE_SIZE);
      set({
        notifications: page.entries,
        unreadCount: page.unread_count,
        loaded: true,
      });
    } finally {
      set({ loading: false });
    }
  },

  refreshUnreadCount: async () => {
    const { unread_count } = await NotificationService.unreadCount();
    set({ unreadCount: unread_count });
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
      };
    });
  },

  clear: () =>
    set({ notifications: [], unreadCount: 0, loading: false, loaded: false }),
}));

/** Reactive selector for the bell's unread badge count. */
export const useUnreadNotificationCount = (): number =>
  useNotificationStore((s) => s.unreadCount);

/** Reset on login/logout so a new session never sees the previous user's data. */
export const resetNotificationStoreForSession = () =>
  useNotificationStore.getState().clear();
