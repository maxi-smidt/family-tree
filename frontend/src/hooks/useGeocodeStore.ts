import { create } from "zustand";
import {
  GeocodeCandidate,
  GeocodeResult,
  mapGeocodeFromDB,
} from "@/types/geocode";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";
import { toast } from "sonner";
import i18n from "@/i18n/i18n";

interface GeocodeState {
  coords: Map<string, GeocodeResult>;
  // Number of geocode requests in flight. The backend resolves unknown
  // locations sequentially against Nominatim (>1s each), so consumers use
  // this to show a loading state instead of a misleading empty one.
  pendingCount: number;
  resolveLocations: (locations: string[]) => Promise<void>;
  // Evicts the given locations from the cache and re-requests them, so a
  // previously-failed lookup gets a fresh attempt (the backend already
  // re-attempts stale failed lookups on its own — see #545 — but this lets
  // the user force an immediate retry instead of waiting).
  retryLocations: (locations: string[]) => Promise<void>;
  // Stores a manual correction (search pick or dropped pin) for a location
  // string that failed to geocode. `location` is the original, un-normalized
  // string as used elsewhere in the app (e.g. a member's birthplace); the
  // backend normalizes it internally for the cache key but echoes the
  // original string back so the returned row can be keyed the same way as
  // every other entry in `coords`.
  overrideLocation: (
    location: string,
    lat: number,
    lon: number,
    displayName?: string,
  ) => Promise<void>;
  // Live Nominatim search for candidates matching an edited query string.
  // Never cached; used by the manual geocode-correction UI.
  searchLocations: (query: string) => Promise<GeocodeCandidate[]>;
  getCoord: (location: string) => GeocodeResult | undefined;
  clear: () => void;
}

export const useGeocodeStore = create<GeocodeState>((set, get) => ({
  coords: new Map(),
  pendingCount: 0,

  resolveLocations: async (locations: string[]) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    // Only request locations not already in cache
    const cached = get().coords;
    const unknown = [...new Set(locations)].filter((loc) => !cached.has(loc));
    if (unknown.length === 0) return;

    set((state) => ({ pendingCount: state.pendingCount + 1 }));
    try {
      const rows = await WorkspaceService.geocodeLocations(workspaceId, unknown);
      if (!isActiveTree(workspaceId)) return;

      set((state) => {
        const next = new Map(state.coords);
        for (const row of rows) {
          next.set(row.query, mapGeocodeFromDB(row));
        }
        return { coords: next };
      });
    } catch (error) {
      console.error("Failed to resolve geocode locations:", error);
      toast.error(i18n.t("hooks.geocode.resolve-error"));
    } finally {
      // clear() may have reset the counter mid-flight; never go negative
      set((state) => ({ pendingCount: Math.max(0, state.pendingCount - 1) }));
    }
  },

  retryLocations: async (locations: string[]) => {
    if (locations.length === 0) return;
    set((state) => {
      const next = new Map(state.coords);
      for (const loc of locations) next.delete(loc);
      return { coords: next };
    });
    await get().resolveLocations(locations);
  },

  overrideLocation: async (
    location: string,
    lat: number,
    lon: number,
    displayName?: string,
  ) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    try {
      const row = await WorkspaceService.geocodeOverride(workspaceId, {
        query: location,
        lat,
        lon,
        display_name: displayName,
      });
      if (!isActiveTree(workspaceId)) return;

      set((state) => {
        const next = new Map(state.coords);
        next.set(location, mapGeocodeFromDB(row));
        return { coords: next };
      });
    } catch (error) {
      console.error("Failed to save manual geocode override:", error);
      toast.error(i18n.t("hooks.geocode.override-error"));
      throw error;
    }
  },

  searchLocations: async (query: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return [];

    try {
      return await WorkspaceService.geocodeSearch(workspaceId, query);
    } catch (error) {
      console.error("Failed to search geocode candidates:", error);
      toast.error(i18n.t("hooks.geocode.search-error"));
      return [];
    }
  },

  getCoord: (location: string) => get().coords.get(location),

  clear: () => set({ coords: new Map(), pendingCount: 0 }),
}));
