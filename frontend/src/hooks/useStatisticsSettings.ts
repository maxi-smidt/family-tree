import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ALL_WIDGET_IDS,
  type StatisticsWidgetId,
} from "@/components/view/statistics-view/widgets";

export function normalizeOrder(
  order: StatisticsWidgetId[],
): StatisticsWidgetId[] {
  const known = new Set(ALL_WIDGET_IDS);
  const kept = order.filter((id) => known.has(id));
  const missing = ALL_WIDGET_IDS.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

interface StatisticsSettingsState {
  order: StatisticsWidgetId[];
  hidden: StatisticsWidgetId[];
  toggleWidget: (id: StatisticsWidgetId) => void;
  moveWidget: (id: StatisticsWidgetId, direction: "up" | "down") => void;
  reset: () => void;
}

export const useStatisticsSettings = create<StatisticsSettingsState>()(
  persist(
    (set) => ({
      order: ALL_WIDGET_IDS,
      hidden: [],
      toggleWidget: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id)
            ? s.hidden.filter((w) => w !== id)
            : [...s.hidden, id],
        })),
      moveWidget: (id, direction) =>
        set((s) => {
          const order = normalizeOrder(s.order);
          const i = order.indexOf(id);
          const j = direction === "up" ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= order.length) return s;
          const next = [...order];
          [next[i], next[j]] = [next[j], next[i]];
          return { order: next };
        }),
      reset: () => set({ order: ALL_WIDGET_IDS, hidden: [] }),
    }),
    { name: "app-statistics-settings", version: 1 },
  ),
);
