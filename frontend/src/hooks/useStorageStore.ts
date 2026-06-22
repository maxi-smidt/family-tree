import { create } from "zustand";
import { TreeStorageUsageDB } from "@/types/storage";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface StorageState {
  usage: TreeStorageUsageDB | null;
  isLoading: boolean;
  error: boolean;
  refreshStorageUsage: (treeId?: string) => Promise<void>;
  clear: () => void;
}

export const useStorageStore = create<StorageState>((set) => ({
  usage: null,
  isLoading: false,
  error: false,

  refreshStorageUsage: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ usage: null, error: false });
      return;
    }
    set({ isLoading: true, error: false });
    try {
      const usage = await TreeService.getStorageUsage(treeId);
      if (!isActiveTree(treeId)) return;
      set({ usage });
    } catch {
      // Surface failures as an error flag instead of letting the rejection
      // bubble into an unhandled promise rejection at the call site.
      if (isActiveTree(treeId)) set({ error: true });
    } finally {
      set({ isLoading: false });
    }
  },

  clear: () => set({ usage: null, error: false }),
}));
