import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ALL_COLUMN_IDS,
  DEFAULT_HIDDEN_COLUMNS,
  type ListColumnId,
} from "@/components/view/list-view/columns";

export function normalizeOrder(order: ListColumnId[]): ListColumnId[] {
  const known = new Set(ALL_COLUMN_IDS);
  const kept = order.filter((id) => known.has(id));
  const missing = ALL_COLUMN_IDS.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

interface ListSettingsState {
  order: ListColumnId[];
  hidden: ListColumnId[];
  pageSize: number;
  toggleColumn: (id: ListColumnId) => void;
  moveColumn: (id: ListColumnId, direction: "up" | "down") => void;
  setPageSize: (size: number) => void;
  reset: () => void;
}

export const useListSettings = create<ListSettingsState>()(
  persist(
    (set) => ({
      order: ALL_COLUMN_IDS,
      hidden: DEFAULT_HIDDEN_COLUMNS,
      pageSize: 25,
      toggleColumn: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id)
            ? s.hidden.filter((c) => c !== id)
            : [...s.hidden, id],
        })),
      moveColumn: (id, direction) =>
        set((s) => {
          const order = normalizeOrder(s.order);
          const i = order.indexOf(id);
          const j = direction === "up" ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= order.length) return s;
          const next = [...order];
          [next[i], next[j]] = [next[j], next[i]];
          return { order: next };
        }),
      setPageSize: (size) => set({ pageSize: size }),
      reset: () =>
        set({
          order: ALL_COLUMN_IDS,
          hidden: DEFAULT_HIDDEN_COLUMNS,
          pageSize: 25,
        }),
    }),
    { name: "app-list-settings", version: 1 },
  ),
);
