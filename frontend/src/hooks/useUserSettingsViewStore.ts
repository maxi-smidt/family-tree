import { create } from "zustand";

interface UserSettingsViewState {
  open: boolean;
  activeSection: string;
  openSettings: (section?: string) => void;
  setActiveSection: (section: string) => void;
  closeSettings: () => void;
}

export const useUserSettingsViewStore = create<UserSettingsViewState>(
  (set) => ({
    open: false,
    activeSection: "gallery",
    openSettings: (section = "gallery") =>
      set({ open: true, activeSection: section }),
    setActiveSection: (section) => set({ activeSection: section }),
    closeSettings: () => set({ open: false }),
  }),
);
