import { create } from "zustand";
import { UserPreferencesService } from "@/services/UserPreferencesService";

interface TutorialState {
  completed: boolean;
  loaded: boolean;
  isRunning: boolean;
  load: () => Promise<void>;
  start: () => void;
  finish: (opts: { skipped: boolean }) => void;
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

  finish({ skipped }) {
    set({ isRunning: false, completed: !skipped });
    if (!skipped) {
      UserPreferencesService.setTutorialCompleted(true).catch(() => undefined);
    }
  },
}));
