import { api } from "@/services/api";

export interface TabPreferences {
  order: string[];
  hidden: string[];
}

const BASE = "/users/me/preferences";

export const UserPreferencesService = {
  getTabPreferences(): Promise<TabPreferences> {
    return api.get<TabPreferences>(`${BASE}/tabs`);
  },

  updateTabPreferences(prefs: TabPreferences): Promise<TabPreferences> {
    return api.put<TabPreferences>(`${BASE}/tabs`, prefs);
  },

  resetTabPreferences(): Promise<TabPreferences> {
    return api.del<TabPreferences>(`${BASE}/tabs`);
  },
};
