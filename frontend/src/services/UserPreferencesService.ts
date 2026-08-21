import { api } from "@/services/api";
import type { ImageStorageMode } from "@/types/user";

export interface TabPreferences {
  order: string[];
  hidden: string[];
}

export interface UserSettings {
  image_storage_mode: ImageStorageMode | null;
}

export interface TutorialState {
  completed: boolean;
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

  getUserSettings(): Promise<UserSettings> {
    return api.get<UserSettings>(`${BASE}/settings`);
  },

  updateUserSettings(settings: UserSettings): Promise<UserSettings> {
    return api.put<UserSettings>(`${BASE}/settings`, settings);
  },

  getTutorialState(): Promise<TutorialState> {
    return api.get<TutorialState>(`${BASE}/tutorial`);
  },

  setTutorialCompleted(completed: boolean): Promise<TutorialState> {
    return api.put<TutorialState>(`${BASE}/tutorial`, { completed });
  },
};
