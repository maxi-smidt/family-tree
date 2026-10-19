import { create } from "zustand";
import { useCallback } from "react";
import {
  CitableField,
  CitationAnchor,
  CitationInput,
  EvidenceCoverage,
  MemberFieldCitation,
  mapCitationFromDB,
  mapEvidenceCoverageFromDB,
} from "@/types/citation";
import { WorkspaceService } from "@/services/WorkspaceService";
import {
  activeTreeId,
  isActiveTree,
  useWorkspaceStore,
} from "@/hooks/useWorkspaceStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

/** Evidence for person fields: which documents back a person's names, dates
 *  and birthplace. The whole workspace's citations load at once; they are
 *  small rows (the quote at most) and every view filters them locally. */
interface CitationState {
  citations: MemberFieldCitation[];
  initialized: boolean;
  refreshCitations: (workspaceId?: string) => Promise<void>;
  /** Evidence coverage for Data quality, fetched fresh each time. */
  loadCoverage: () => Promise<EvidenceCoverage | null>;
  getForMember: (memberId: string) => MemberFieldCitation[];
  getForField: (memberId: string, field: CitableField) => MemberFieldCitation[];
  getForDocument: (documentId: string) => MemberFieldCitation[];
  addCitation: (input: CitationInput) => Promise<MemberFieldCitation | null>;
  updateCitation: (
    id: string,
    anchor: CitationAnchor,
  ) => Promise<MemberFieldCitation | null>;
  removeCitation: (id: string) => Promise<void>;
  clear: () => void;
}

// One request per workspace at a time, however many views ask at once.
let inFlight: { workspaceId: string; promise: Promise<void> } | null = null;

export const useCitationStore = create<CitationState>((set, get) => ({
  citations: [],
  initialized: false,

  refreshCitations: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ citations: [] });
      return;
    }
    if (inFlight?.workspaceId === workspaceId) return inFlight.promise;
    const promise = (async () => {
      const rows = await WorkspaceService.getCitations(workspaceId);
      if (!isActiveTree(workspaceId)) return;
      set({ citations: rows.map(mapCitationFromDB), initialized: true });
    })();
    inFlight = { workspaceId, promise };
    try {
      await promise;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  },

  loadCoverage: async () => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return null;
    const row = await WorkspaceService.getEvidenceCoverage(workspaceId);
    if (!isActiveTree(workspaceId)) return null;
    return mapEvidenceCoverageFromDB(row);
  },

  getForMember: (memberId) =>
    get().citations.filter((c) => c.memberId === memberId),

  getForField: (memberId, field) =>
    get().citations.filter((c) => c.memberId === memberId && c.field === field),

  getForDocument: (documentId) =>
    get().citations.filter((c) => c.documentId === documentId),

  addCitation: async (input) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return null;
    const row = await WorkspaceService.addCitation(workspaceId, input);
    if (!isActiveTree(workspaceId)) return null;
    const citation = mapCitationFromDB(row);
    // A realtime refresh may have brought the new row in already.
    set((state) => ({
      citations: [
        ...state.citations.filter((c) => c.id !== citation.id),
        citation,
      ],
    }));
    invalidateActivityView();
    return citation;
  },

  updateCitation: async (id, anchor) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return null;
    const row = await WorkspaceService.updateCitation(workspaceId, id, anchor);
    if (!isActiveTree(workspaceId)) return null;
    const citation = mapCitationFromDB(row);
    set((state) => ({
      citations: state.citations.map((c) => (c.id === id ? citation : c)),
    }));
    invalidateActivityView();
    return citation;
  },

  removeCitation: async (id) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.removeCitation(workspaceId, id);
    if (!isActiveTree(workspaceId)) return;
    set((state) => ({
      citations: state.citations.filter((c) => c.id !== id),
    }));
    invalidateActivityView();
  },

  clear: () => set({ citations: [], initialized: false }),
}));

/** Whether citations can be shown here: they belong to the Documents area. */
export function useCitationsEnabled(): boolean {
  return useWorkspaceStore(
    (s) =>
      !!s.selectedTree &&
      !(s.selectedTree.restrictions ?? []).includes("sources"),
  );
}

/** Load the workspace's citations once something shows them. A failed load
 *  just leaves them out; the views work without evidence. */
export function useLoadCitations(enabled = true): void {
  const initialized = useCitationStore((s) => s.initialized);
  const refresh = useCitationStore((s) => s.refreshCitations);
  const visible = useCitationsEnabled();
  const load = useCallback(
    (workspaceId: string) => refresh(workspaceId).catch(() => {}),
    [refresh],
  );
  useDeferredStoreLoad(initialized || !visible || !enabled, load);
}
