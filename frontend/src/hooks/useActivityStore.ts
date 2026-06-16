import { create } from "zustand";
import { Activity, mapActivityFromDB } from "@/types/activity";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface ActivityState {
  activities: Activity[];
  filterActor: string;
  filterAction: string;
  filterTargetType: string;
  initialized: boolean;
  refreshActivity: (treeId?: string) => Promise<void>;
  setFilter: (
    key: "filterActor" | "filterAction" | "filterTargetType",
    val: string,
  ) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],
  filterActor: "",
  filterAction: "",
  filterTargetType: "",
  initialized: false,

  refreshActivity: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ activities: [] });
      return;
    }
    const result = await TreeService.getActivity(treeId);
    if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight — drop stale data
    set({ activities: result.map(mapActivityFromDB), initialized: true });
  },

  setFilter: (key, val) => set({ [key]: val }),

  clear: () => set({ activities: [], initialized: false }),
}));

export function selectFilteredActivities(state: ActivityState): Activity[] {
  const { activities, filterActor, filterAction, filterTargetType } = state;
  return activities.filter((a) => {
    if (filterActor && a.actorUsername !== filterActor) return false;
    if (filterAction && a.action !== filterAction) return false;
    if (filterTargetType && a.targetType !== filterTargetType) return false;
    return true;
  });
}
