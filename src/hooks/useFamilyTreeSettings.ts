import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EdgeType = "default" | "straight" | "step" | "smoothstep";

interface FamilyTreeSettingsState {
  edgeType: EdgeType;
  setEdgeType: (type: EdgeType) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (val: boolean) => void;
}

export const useFamilyTreeSettings = create<FamilyTreeSettingsState>()(
  persist(
    (set) => ({
      edgeType: "step",
      sidebarOpen: true,
      setEdgeType: (type) => set({ edgeType: type }),
      setSidebarOpen: (val: boolean) => set({ sidebarOpen: val }),
    }),
    {
      name: "app-ui-settings",
    },
  ),
);
