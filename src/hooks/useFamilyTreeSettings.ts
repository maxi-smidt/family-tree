import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Database } from "@/types/database.ts";
import { DEFAULT_DB } from "@/utils/constants.ts";

export type EdgeType = "default" | "straight" | "step" | "smoothstep";

interface FamilyTreeSettingsState {
  edgeType: EdgeType;
  setEdgeType: (type: EdgeType) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (val: boolean) => void;
  isLockedScreen: boolean;
  setIsLockedScreen: (val: boolean) => void;
  databases: Database[];
  setDatabases: (dbs: Database[]) => void;
  selectedDatabase: Database;
  setSelectedDatabase: (db: Database) => void;
}

export const useFamilyTreeSettings = create<FamilyTreeSettingsState>()(
  persist(
    (set) => ({
      edgeType: "step",
      isLockedScreen: false,
      sidebarOpen: true,
      databases: [DEFAULT_DB],
      selectedDatabase: DEFAULT_DB,
      setEdgeType: (type) => set({ edgeType: type }),
      setSidebarOpen: (val: boolean) => set({ sidebarOpen: val }),
      setIsLockedScreen: (val: boolean) => set({ isLockedScreen: val }),
      setDatabases: (dbs: Database[]) => set({ databases: dbs }),
      setSelectedDatabase: (db: Database) => set({ selectedDatabase: db }),
    }),
    {
      name: "app-ui-settings",
    },
  ),
);
