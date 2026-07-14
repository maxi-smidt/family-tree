import { create } from "zustand";
import { UserPreferencesService } from "@/services/UserPreferencesService";

interface WhatsNewState {
  lastReadVersion: string | null;
  loaded: boolean;
  dismissed: boolean;
  load: () => Promise<void>;
  markAsRead: () => Promise<void>;
}

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  lastReadVersion: null,
  loaded: false,
  dismissed: false,

  async load() {
    if (get().loaded) return;
    try {
      const state = await UserPreferencesService.getWhatsNewState();
      set({ lastReadVersion: state.last_read_version, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async markAsRead() {
    set({ dismissed: true });
    try {
      const state = await UserPreferencesService.markWhatsNewAsRead();
      set({ lastReadVersion: state.last_read_version });
    } catch {
      // Keep this session dismissed; a later session retries persistence.
    }
  },
}));

export const resetWhatsNewStoreForSession = () => {
  useWhatsNewStore.setState({
    lastReadVersion: null,
    loaded: false,
    dismissed: false,
  });
};
