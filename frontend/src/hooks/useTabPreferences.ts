import { create } from "zustand";
import { UserPreferencesService } from "@/services/UserPreferencesService";

interface TabPreferencesState {
  order: string[];
  hidden: string[];
  loaded: boolean;
  load: () => Promise<void>;
  setOrder: (order: string[]) => void;
  toggleHidden: (id: string) => void;
  reset: () => Promise<void>;
}

export const useTabPreferences = create<TabPreferencesState>((set, get) => ({
  order: [],
  hidden: [],
  loaded: false,

  async load() {
    try {
      const prefs = await UserPreferencesService.getTabPreferences();
      set({ order: prefs.order, hidden: prefs.hidden, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setOrder(order: string[]) {
    set({ order });
    UserPreferencesService.updateTabPreferences({
      order,
      hidden: get().hidden,
    }).catch(() => undefined);
  },

  toggleHidden(id: string) {
    const hidden = get().hidden;
    const next = hidden.includes(id)
      ? hidden.filter((h) => h !== id)
      : [...hidden, id];
    set({ hidden: next });
    UserPreferencesService.updateTabPreferences({
      order: get().order,
      hidden: next,
    }).catch(() => undefined);
  },

  async reset() {
    await UserPreferencesService.resetTabPreferences();
    set({ order: [], hidden: [] });
  },
}));
