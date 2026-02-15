import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Database } from "@/types/database";

export type EdgeType = "default" | "straight" | "step" | "smoothstep";

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface FamilyTreeSettingsState {
  edgeType: EdgeType;
  setEdgeType: (type: EdgeType) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (val: boolean) => void;
  isLockedScreen: boolean;
  setIsLockedScreen: (val: boolean) => void;
  isFastMode: boolean;
  setIsFastMode: (val: boolean) => void;
  isDiseaseMode: boolean;
  setIsDiseaseMode: (val: boolean) => void;
  databases: Database[];
  addDatabase: (newDb: Database) => void;
  selectedDatabase: Database | undefined;
  setSelectedDatabase: (db: Database | undefined) => void;
  removeDatabase: (db: Database) => void;
  visibleRelationTypes: string[];
  toggleRelationType: (type: string) => void;
  viewport: Viewport;
  setViewport: (viewport: Viewport) => void;
}

export const useFamilyTreeSettings = create<FamilyTreeSettingsState>()(
  persist(
    (set) => ({
      edgeType: "step",
      isLockedScreen: false,
      isFastMode: false,
      isDiseaseMode: false,
      sidebarOpen: true,
      databases: [],
      selectedDatabase: undefined,
      visibleRelationTypes: ["parent"],
      viewport: { x: 0, y: 0, zoom: 1 },
      setEdgeType: (type) => set({ edgeType: type }),
      setSidebarOpen: (val: boolean) => set({ sidebarOpen: val }),
      setIsLockedScreen: (val: boolean) => set({ isLockedScreen: val }),
      setIsFastMode: (val: boolean) => set({ isFastMode: val }),
      setIsDiseaseMode: (val: boolean) => set({ isDiseaseMode: val }),
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
      toggleRelationType: (type) =>
        set((state) => {
          if (type === "parent") return state;
          const isVisible = state.visibleRelationTypes.includes(type);
          return {
            visibleRelationTypes: isVisible
              ? state.visibleRelationTypes.filter((t) => t !== type)
              : [...state.visibleRelationTypes, type],
          };
        }),
      setViewport: (viewport) => set({ viewport }),
    }),
    {
      name: "app-ui-settings",
    },
  ),
);
