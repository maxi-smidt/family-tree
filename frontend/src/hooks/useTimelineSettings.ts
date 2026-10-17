import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TimelineSortOrder = "newest" | "oldest";

interface TimelineSettingsState {
  showDetails: boolean;
  setShowDetails: (val: boolean) => void;
  sortOrder: TimelineSortOrder;
  setSortOrder: (order: TimelineSortOrder) => void;
}

export const useTimelineSettings = create<TimelineSettingsState>()(
  persist(
    (set) => ({
      showDetails: false,
      setShowDetails: (val) => set({ showDetails: val }),
      sortOrder: "newest",
      setSortOrder: (sortOrder) => set({ sortOrder }),
    }),
    { name: "app-timeline-settings", version: 1 },
  ),
);
