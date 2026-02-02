import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Database } from "@/types/database";

export type EdgeType = "default" | "straight" | "step" | "smoothstep";

interface FamilyTreeSettingsState {
  edgeType: EdgeType;
  setEdgeType: (type: EdgeType) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (val: boolean) => void;
  isLockedScreen: boolean;
  setIsLockedScreen: (val: boolean) => void;
  databases: Database[];
  addDatabase: (newDb: Database) => void;
  selectedDatabase: Database | undefined;
  setSelectedDatabase: (db: Database | undefined) => void;
  removeDatabase: (db: Database) => void;
}

export const useFamilyTreeSettings = create<FamilyTreeSettingsState>()(
  persist(
    (set) => ({
      edgeType: "step",
      isLockedScreen: false,
      sidebarOpen: true,
      databases: [],
      selectedDatabase: undefined,
      setEdgeType: (type) => set({ edgeType: type }),
      setSidebarOpen: (val: boolean) => set({ sidebarOpen: val }),
      setIsLockedScreen: (val: boolean) => set({ isLockedScreen: val }),
      addDatabase: (newDb) =>
        set((state) => {
          const isDuplicate = state.databases.some((d) => d.id === newDb.id);
          return {
            databases: isDuplicate
              ? state.databases.map((d) => (d.id === newDb.id ? newDb : d))
              : [...state.databases, newDb],
          };
        }),
      setSelectedDatabase: (db: Database | undefined) =>
        set({ selectedDatabase: db }),
      removeDatabase: (db: Database) =>
        set((state) => ({
          databases: state.databases.filter((d) => d.id !== db.id),
        })),
    }),
    {
      name: "app-ui-settings",
    },
  ),
);
