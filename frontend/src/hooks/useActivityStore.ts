import { create } from "zustand";
import { Activity, mapActivityFromDB } from "@/types/activity";
import { TreeService } from "@/services/TreeService";
import { activeTreeId } from "@/hooks/useTreeStore";

interface ActivityState {
  activities: Activity[];
  refreshActivity: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],

  refreshActivity: async () => {
    const treeId = activeTreeId();
    if (!treeId) {
      set({ activities: [] });
      return;
    }
    const result = await TreeService.getActivity(treeId);
    set({ activities: result.map(mapActivityFromDB) });
  },
}));
