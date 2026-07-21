import { create } from "zustand";
import { QualityReport } from "@/types/quality";
import { MergeFieldChoice } from "@/types/merge";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { useMemberStore } from "@/hooks/useMemberStore";

interface QualityReportState {
  report: QualityReport | null;
  isLoading: boolean;
  showDismissed: boolean;
  refreshReport: (treeId?: string) => Promise<void>;
  setShowDismissed: (show: boolean) => void;
  dismissIssue: (issueId: string) => Promise<void>;
  restoreIssue: (issueId: string) => Promise<void>;
  resolveBridgeDrift: (
    memberId: string,
    direction: "push" | "pull",
  ) => Promise<void>;
  mergeMembers: (
    keepId: string,
    removeId: string,
    fields: Partial<Record<string, MergeFieldChoice>>,
  ) => Promise<void>;
  clear: () => void;
}

export const useQualityReportStore = create<QualityReportState>((set, get) => ({
  report: null,
  isLoading: false,
  showDismissed: false,

  refreshReport: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report = await TreeService.getQualityReport(treeId);
      if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight — drop stale data
      set({ report });
    } finally {
      set({ isLoading: false });
    }
  },

  setShowDismissed: (show: boolean) => set({ showDismissed: show }),

  dismissIssue: async (issueId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.dismissQualityIssue(treeId, issueId);
    await get().refreshReport(treeId);
  },

  restoreIssue: async (issueId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.restoreQualityIssue(treeId, issueId);
    await get().refreshReport(treeId);
  },

  // Resolve bridge-person drift by copying fields across the tree link
  // ("push" = this tree wins, "pull" = the linked tree wins), then reload the
  // report and — on pull — the members, whose fields just changed. Errors
  // (e.g. 403 without write access to the linked tree) propagate to the view.
  resolveBridgeDrift: async (memberId: string, direction: "push" | "pull") => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.resolveBridgeDrift(treeId, memberId, direction);
    const tasks: Promise<void>[] = [get().refreshReport(treeId)];
    if (direction === "pull") {
      tasks.push(useMemberStore.getState().refreshMembers(treeId));
    }
    await Promise.all(tasks);
  },

  // Merge two members of the tree in place (#729): the report and member
  // list both change shape (a duplicate finding disappears, a member is
  // gone), so refresh both. Errors (e.g. the 400 cycle guard) propagate to
  // the dialog, which maps them to a specific message.
  mergeMembers: async (keepId, removeId, fields) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.mergeMembers(treeId, {
      keep_id: keepId,
      remove_id: removeId,
      fields,
    });
    await Promise.all([
      get().refreshReport(treeId),
      useMemberStore.getState().refreshMembers(treeId),
    ]);
  },

  clear: () => set({ report: null, showDismissed: false }),
}));
