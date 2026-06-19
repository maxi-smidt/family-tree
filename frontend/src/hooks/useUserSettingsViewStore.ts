import { create } from "zustand";

interface UserSettingsViewState {
  open: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUserSettingsViewStore = create<UserSettingsViewState>(
  (set) => ({
    open: false,
    openSettings: () => set({ open: true }),
    closeSettings: () => set({ open: false }),
  }),
);
