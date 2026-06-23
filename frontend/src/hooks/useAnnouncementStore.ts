import { create } from "zustand";
import {
  Announcement,
  UserPreferencesService,
} from "@/services/UserPreferencesService";

interface AnnouncementState {
  announcement: Announcement | null;
  loaded: boolean;
  dismissed: boolean;
  load: () => Promise<void>;
  acknowledge: () => Promise<void>;
}

export const useAnnouncementStore = create<AnnouncementState>((set, get) => ({
  announcement: null,
  loaded: false,
  dismissed: false,

  async load() {
    if (get().loaded) return;
    try {
      const data = await UserPreferencesService.getAnnouncement();
      set({ announcement: data, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async acknowledge() {
    const { announcement } = get();
    if (!announcement) return;
    set({ dismissed: true });
    try {
      await UserPreferencesService.acknowledgeAnnouncement(announcement.version);
      set((s) => ({
        announcement: s.announcement
          ? {
              ...s.announcement,
              acknowledged_version: s.announcement.version,
            }
          : null,
      }));
    } catch {
      // silently ignore network errors — the dismissed flag still hides the popup
    }
  },
}));
