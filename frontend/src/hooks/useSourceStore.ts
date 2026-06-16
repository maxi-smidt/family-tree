import { create } from "zustand";
import {
  Citation,
  CitationInput,
  EvidenceOps,
  Source,
  SourceInput,
  mapCitationFromDB,
  mapSourceFromDB,
} from "@/types/source";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

const NO_OPS: EvidenceOps = {
  addedFiles: [],
  addedLinks: [],
  removedIds: [],
  renamed: [],
};

interface SourceState {
  sources: Source[];
  citations: Citation[];
  initialized: boolean;
  refreshSources: (treeId?: string) => Promise<void>;
  getCitationsByMember: (memberId: string) => Citation[];
  getSourcesForMember: (memberId: string) => Source[];
  addSource: (input: SourceInput, evidenceOps?: EvidenceOps) => Promise<Source | null>;
  updateSource: (
    id: string,
    input: SourceInput,
    evidenceOps?: EvidenceOps,
  ) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  addCitation: (input: CitationInput) => Promise<void>;
  updateCitation: (id: string, input: Omit<CitationInput, "sourceId" | "memberId">) => Promise<void>;
  removeCitation: (id: string) => Promise<void>;
  clear: () => void;
}

export const useSourceStore = create<SourceState>((set, get) => ({
  sources: [],
  citations: [],
  initialized: false,

  refreshSources: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ sources: [], citations: [] });
      return;
    }

    const [sourcesResult, citationsResult] = await Promise.all([
      TreeService.getSources(treeId),
      TreeService.getCitations(treeId),
    ]);

    if (!isActiveTree(treeId)) return;

    set({
      sources: sourcesResult.map(mapSourceFromDB),
      citations: citationsResult.map(mapCitationFromDB),
      initialized: true,
    });
  },

  getCitationsByMember: (memberId: string) => {
    return get().citations.filter((c) => c.memberId === memberId);
  },

  getSourcesForMember: (memberId: string) => {
    const citedSourceIds = new Set(
      get()
        .citations.filter((c) => c.memberId === memberId)
        .map((c) => c.sourceId),
    );
    return get().sources.filter((s) => citedSourceIds.has(s.id));
  },

  addSource: async (input: SourceInput, evidenceOps: EvidenceOps = NO_OPS) => {
    const treeId = activeTreeId();
    if (!treeId) return null;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const row = await TreeService.addSource(treeId, id, input, now);
    const source = mapSourceFromDB(row);

    await Promise.all(TreeService.applyEvidenceOps(treeId, id, evidenceOps) as Promise<void>[]);
    await get().refreshSources(treeId);
    return source;
  },

  updateSource: async (
    id: string,
    input: SourceInput,
    evidenceOps: EvidenceOps = NO_OPS,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.updateSource(treeId, id, input);
    await Promise.all(TreeService.applyEvidenceOps(treeId, id, evidenceOps) as Promise<void>[]);
    await get().refreshSources(treeId);
  },

  removeSource: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeSource(treeId, id);
    await get().refreshSources(treeId);
  },

  addCitation: async (input: CitationInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await TreeService.addCitation(
      treeId,
      id,
      input.sourceId,
      input.memberId,
      input.factType,
      input.page || null,
      input.detail || null,
      now,
    );
    await get().refreshSources(treeId);
  },

  updateCitation: async (
    id: string,
    input: Omit<CitationInput, "sourceId" | "memberId">,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.updateCitation(
      treeId,
      id,
      input.factType,
      input.page || null,
      input.detail || null,
    );
    await get().refreshSources(treeId);
  },

  removeCitation: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeCitation(treeId, id);
    await get().refreshSources(treeId);
  },

  clear: () => set({ sources: [], citations: [], initialized: false }),
}));
