import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TimelineSettingsState {
  showDetails: boolean;
  setShowDetails: (val: boolean) => void;
}

export const useTimelineSettings = create<TimelineSettingsState>()(
  persist(
    (set) => ({
      showDetails: true,
      setShowDetails: (val) => set({ showDetails: val }),
    }),
    { name: "app-timeline-settings", version: 1 },
  ),
);
