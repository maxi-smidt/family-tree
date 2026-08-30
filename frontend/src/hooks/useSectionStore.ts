import { create } from "zustand";
import {
  SectionCreateInput,
  SectionDB,
  SectionDependentsDB,
  SectionPreviewDB,
  SectionUpdateInput,
} from "@/types/section";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

interface SectionState {
  sections: SectionDB[];
  initialized: boolean;
  loading: boolean;
  refreshSections: (workspaceId?: string) => Promise<void>;
  previewSection: (
    rootMemberId: string,
    direction: "direct_family" | "partnership",
  ) => Promise<SectionPreviewDB>;
  createSection: (payload: SectionCreateInput) => Promise<SectionDB>;
  updateSection: (
    sectionId: string,
    payload: SectionUpdateInput,
  ) => Promise<void>;
  getSectionDependents: (sectionId: string) => Promise<SectionDependentsDB>;
  deleteSection: (sectionId: string, reassignScopeTo?: string) => Promise<void>;
  clear: () => void;
}

export const useSectionStore = create<SectionState>((set, get) => {
  // Guards against a slower, superseded refresh overwriting a newer one —
  // same pattern as useActivityStore.
  let requestId = 0;

  return {
    sections: [],
    initialized: false,
    loading: false,

    refreshSections: async (workspaceId = activeTreeId()) => {
      if (!workspaceId) {
        set({ sections: [], initialized: false });
        return;
      }
      const reqId = ++requestId;
      set({ loading: true });
      try {
        const sections = await WorkspaceService.getSections(workspaceId);
        if (reqId !== requestId || !isActiveTree(workspaceId)) return;
        set({ sections, initialized: true, loading: false });
      } catch {
        if (reqId !== requestId || !isActiveTree(workspaceId)) return;
        set({ loading: false });
      }
    },

    previewSection: (rootMemberId, direction) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) throw new Error("No active tree");
      return WorkspaceService.previewSection(
        workspaceId,
        rootMemberId,
        direction,
      );
    },

    createSection: async (payload) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) throw new Error("No active tree");
      const section = await WorkspaceService.createSection(
        workspaceId,
        payload,
      );
      await get().refreshSections(workspaceId);
      return section;
    },

    updateSection: async (sectionId, payload) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) return;
      await WorkspaceService.updateSection(workspaceId, sectionId, payload);
      await get().refreshSections(workspaceId);
    },

    getSectionDependents: (sectionId) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) throw new Error("No active tree");
      return WorkspaceService.getSectionDependents(workspaceId, sectionId);
    },

    deleteSection: async (sectionId, reassignScopeTo) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) return;
      await WorkspaceService.deleteSection(
        workspaceId,
        sectionId,
        reassignScopeTo,
      );
      await get().refreshSections(workspaceId);
    },

    clear: () => {
      requestId++;
      set({ sections: [], initialized: false, loading: false });
    },
  };
});
