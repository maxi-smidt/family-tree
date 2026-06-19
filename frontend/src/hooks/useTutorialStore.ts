import { create } from "zustand";
import { UserPreferencesService } from "@/services/UserPreferencesService";

interface TutorialState {
  completed: boolean;
  loaded: boolean;
  isRunning: boolean;
  load: () => Promise<void>;
  start: () => void;
  finish: () => void;
}

export const useTutorialStore = create<TutorialState>((set, get) => ({
  completed: false,
  loaded: false,
  isRunning: false,

  async load() {
    if (get().loaded) return;
    try {
      const state = await UserPreferencesService.getTutorialState();
      set({ completed: state.completed, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  start() {
    set({ isRunning: true });
  },

  finish() {
    set({ isRunning: false, completed: true });
    UserPreferencesService.setTutorialCompleted(true).catch(() => undefined);
  },
}));
