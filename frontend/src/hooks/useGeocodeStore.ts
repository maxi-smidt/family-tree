import { create } from "zustand";
import { GeocodeResult, mapGeocodeFromDB } from "@/types/geocode";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface GeocodeState {
  coords: Map<string, GeocodeResult>;
  resolveLocations: (locations: string[]) => Promise<void>;
  getCoord: (location: string) => GeocodeResult | undefined;
  clear: () => void;
}

export const useGeocodeStore = create<GeocodeState>((set, get) => ({
  coords: new Map(),

  resolveLocations: async (locations: string[]) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    // Only request locations not already in cache
    const cached = get().coords;
    const unknown = [...new Set(locations)].filter((loc) => !cached.has(loc));
    if (unknown.length === 0) return;

    const rows = await TreeService.geocodeLocations(treeId, unknown);
    if (!isActiveTree(treeId)) return;

    set((state) => {
      const next = new Map(state.coords);
      for (const row of rows) {
        next.set(row.query, mapGeocodeFromDB(row));
      }
      return { coords: next };
    });
  },

  getCoord: (location: string) => get().coords.get(location),

  clear: () => set({ coords: new Map() }),
}));
