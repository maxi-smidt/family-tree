import { create } from "zustand";
import { Activity, mapActivityFromDB } from "@/types/activity";
import { TreeService } from "@/services/TreeService";
import { activeTreeId } from "@/hooks/useTreeStore";

interface ActivityState {
  activities: Activity[];
  filterActor: string;
  filterAction: string;
  filterTargetType: string;
  refreshActivity: () => Promise<void>;
  setFilter: (
    key: "filterActor" | "filterAction" | "filterTargetType",
    val: string,
  ) => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],
  filterActor: "",
  filterAction: "",
  filterTargetType: "",

  refreshActivity: async () => {
    const treeId = activeTreeId();
    if (!treeId) {
      set({ activities: [] });
      return;
    }
    const result = await TreeService.getActivity(treeId);
    set({ activities: result.map(mapActivityFromDB) });
  },

  setFilter: (key, val) => set({ [key]: val }),
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
