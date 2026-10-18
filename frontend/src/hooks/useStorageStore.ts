import { create } from "zustand";
import { WorkspaceStorageUsageDB } from "@/types/storage";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

interface StorageState {
  usage: WorkspaceStorageUsageDB | null;
  isLoading: boolean;
  error: boolean;
  refreshStorageUsage: (workspaceId?: string) => Promise<void>;
  clear: () => void;
}

export const useStorageStore = create<StorageState>((set) => ({
  usage: null,
  isLoading: false,
  error: false,

  refreshStorageUsage: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ usage: null, error: false });
      return;
    }
    set({ isLoading: true, error: false });
    try {
      const usage = await WorkspaceService.getStorageUsage(workspaceId);
      if (!isActiveTree(workspaceId)) return;
      set({ usage });
    } catch {
      // Surface failures as an error flag instead of letting the rejection
      // bubble into an unhandled promise rejection at the call site.
      if (isActiveTree(workspaceId)) set({ error: true });
    } finally {
      set({ isLoading: false });
    }
  },

  clear: () => set({ usage: null, error: false }),
}));
