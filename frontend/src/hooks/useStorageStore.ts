import { create } from "zustand";
import { TreeStorageUsageDB } from "@/types/storage";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface StorageState {
  usage: TreeStorageUsageDB | null;
  isLoading: boolean;
  refreshStorageUsage: (treeId?: string) => Promise<void>;
  clear: () => void;
}

export const useStorageStore = create<StorageState>((set) => ({
  usage: null,
  isLoading: false,

  refreshStorageUsage: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ usage: null });
      return;
    }
    set({ isLoading: true });
    try {
      const usage = await TreeService.getStorageUsage(treeId);
      if (!isActiveTree(treeId)) return;
      set({ usage });
    } finally {
      set({ isLoading: false });
    }
  },

  clear: () => set({ usage: null }),
}));
