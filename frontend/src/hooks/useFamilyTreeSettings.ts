import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isGenerationLineGap } from "@/utils/generationLineSpacing";

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
  showGenerationLines: boolean;
  setShowGenerationLines: (val: boolean) => void;
  generationLineGaps: Record<string, number>;
  setGenerationLineGap: (treeId: string, gap: number) => void;
  visibleRelationTypes: string[];
  toggleRelationType: (type: string) => void;
  viewports: Record<string, Viewport>;
  setViewport: (treeId: string, viewport: Viewport) => void;
}

export const useFamilyTreeSettings = create<FamilyTreeSettingsState>()(
  persist(
    (set) => ({
      edgeType: "step",
      isLockedScreen: false,
      isFastMode: false,
      isDiseaseMode: false,
      showGenerationLines: true,
      generationLineGaps: {},
      sidebarOpen: true,
      visibleRelationTypes: ["parent"],
      viewports: {},
      setEdgeType: (type) => set({ edgeType: type }),
      setSidebarOpen: (val: boolean) => set({ sidebarOpen: val }),
      setIsLockedScreen: (val: boolean) => set({ isLockedScreen: val }),
      setIsFastMode: (val: boolean) => set({ isFastMode: val }),
      setIsDiseaseMode: (val: boolean) => set({ isDiseaseMode: val }),
      setShowGenerationLines: (val: boolean) =>
        set({ showGenerationLines: val }),
      setGenerationLineGap: (treeId, gap) => {
        if (!isGenerationLineGap(gap)) return;
        set((s) => ({
          generationLineGaps: { ...s.generationLineGaps, [treeId]: gap },
        }));
      },
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
      setViewport: (treeId, viewport) =>
        set((s) => ({ viewports: { ...s.viewports, [treeId]: viewport } })),
    }),
    {
      name: "app-ui-settings",
    },
  ),
);
