import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ALL_WIDGET_IDS,
  type StatisticsWidgetId,
} from "@/components/view/statistics-view/widgets";
import type {
  CustomWidget,
  CustomWidgetConfig,
} from "@/components/view/statistics-view/customWidgets";

// Widened to string so custom widget ids (custom:uuid) can coexist with built-in ids.
export function normalizeOrder(
  order: string[],
  customIds: string[],
): string[] {
  const known = new Set<string>([...ALL_WIDGET_IDS, ...customIds]);
  const kept = order.filter((id) => known.has(id));
  const missingBuiltins = ALL_WIDGET_IDS.filter((id) => !kept.includes(id));
  // Custom widgets that are known but not yet in order get appended after built-ins.
  const missingCustom = customIds.filter((id) => !kept.includes(id));
  return [...kept, ...missingBuiltins, ...missingCustom];
}

interface StatisticsSettingsState {
  order: string[];
  hidden: string[];
  customWidgets: CustomWidget[];
  toggleWidget: (id: string) => void;
  moveWidget: (id: string, direction: "up" | "down") => void;
  addCustomWidget: (config: CustomWidgetConfig) => void;
  updateCustomWidget: (id: string, config: CustomWidgetConfig) => void;
  removeCustomWidget: (id: string) => void;
  reset: () => void;
}

export const useStatisticsSettings = create<StatisticsSettingsState>()(
  persist(
    (set) => ({
      order: ALL_WIDGET_IDS as string[],
      hidden: [] as string[],
      customWidgets: [] as CustomWidget[],

      toggleWidget: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id)
            ? s.hidden.filter((w) => w !== id)
            : [...s.hidden, id],
        })),

      moveWidget: (id, direction) =>
        set((s) => {
          const customIds = s.customWidgets.map((w) => w.id);
          const order = normalizeOrder(s.order, customIds);
          const i = order.indexOf(id);
          const j = direction === "up" ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= order.length) return s;
          const next = [...order];
          [next[i], next[j]] = [next[j], next[i]];
          return { order: next };
        }),

      addCustomWidget: (config) =>
        set((s) => {
          const id = `custom:${crypto.randomUUID()}`;
          const widget: CustomWidget = { ...config, id, kind: "custom" };
          return {
            customWidgets: [...s.customWidgets, widget],
            order: [...s.order, id],
          };
        }),

      updateCustomWidget: (id, config) =>
        set((s) => ({
          customWidgets: s.customWidgets.map((w) =>
            w.id === id ? { ...config, id, kind: "custom" } : w,
          ),
        })),

      removeCustomWidget: (id) =>
        set((s) => ({
          customWidgets: s.customWidgets.filter((w) => w.id !== id),
          order: s.order.filter((oid) => oid !== id),
          hidden: s.hidden.filter((hid) => hid !== id),
        })),

      reset: () =>
        set((s) => ({
          order: [
            ...(ALL_WIDGET_IDS as string[]),
            ...s.customWidgets.map((w) => w.id),
          ],
          hidden: [],
        })),
    }),
    {
      name: "app-statistics-settings",
      version: 3,
      migrate: (persisted, version) => {
        const state = persisted as Partial<StatisticsSettingsState>;
        // v1 → v2 introduced customWidgets.
        if (version < 2 || !Array.isArray(state.customWidgets)) {
          state.customWidgets = [];
        }
        // v2 → v3 reshaped custom widgets from a series[] model to a
        // dimension/measure pivot. Drop any widget lacking the new fields.
        if (version < 3) {
          state.customWidgets = (state.customWidgets ?? []).filter(
            (w) => "dimensionId" in w && "measureId" in w,
          );
          const customIds = new Set(state.customWidgets.map((w) => w.id));
          state.order = (state.order ?? []).filter(
            (id) => !id.startsWith("custom:") || customIds.has(id),
          );
          state.hidden = (state.hidden ?? []).filter(
            (id) => !id.startsWith("custom:") || customIds.has(id),
          );
        }
        return state as StatisticsSettingsState;
      },
    },
  ),
);

// Convenience selector used by components — keeps the StatisticsWidgetId union
// available for the built-in widget map lookup.
export type { StatisticsWidgetId };
