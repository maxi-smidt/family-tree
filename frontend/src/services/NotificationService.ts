import { api } from "@/services/api";
import { NotificationPage } from "@/types/notification";

/** Thin HTTP client for the notification inbox API. Stores call these; components don't. */
export const NotificationService = {
  list(limit = 25, offset = 0): Promise<NotificationPage> {
    return api.get<NotificationPage>("/notifications", { limit, offset });
  },

  unreadCount(): Promise<{ unread_count: number }> {
    return api.get<{ unread_count: number }>("/notifications/unread-count");
  },

  markRead(id: string): Promise<void> {
    return api.post<void>(`/notifications/${id}/read`, {});
  },

  markAllRead(): Promise<void> {
    return api.post<void>("/notifications/read-all", {});
  },
};
