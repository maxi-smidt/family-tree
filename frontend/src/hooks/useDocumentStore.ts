import { create } from "zustand";
import {
  Document,
  DocumentFileOps,
  DocumentInput,
  mapDocumentFromDB,
} from "@/types/document";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

const NO_OPS: DocumentFileOps = {
  addedFiles: [],
  addedLinks: [],
  removedIds: [],
  renamed: [],
};

interface DocumentState {
  documents: Document[];
  initialized: boolean;
  refreshDocuments: (treeId?: string) => Promise<void>;
  getDocumentsForMember: (memberId: string) => Document[];
  addDocument: (
    input: DocumentInput,
    memberIds: string[],
    fileOps?: DocumentFileOps,
  ) => Promise<Document | null>;
  updateDocument: (
    id: string,
    input: DocumentInput,
    memberIds: string[],
    fileOps?: DocumentFileOps,
  ) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  clear: () => void;
}

/** Apply the queued file changes (delete → rename → add). Returns true when a
 *  file was actually created or removed, so callers can refresh storage usage. */
async function applyFileOps(
  treeId: string,
  documentId: string,
  ops: DocumentFileOps,
): Promise<boolean> {
  for (const id of ops.removedIds) {
    await TreeService.removeDocumentFile(treeId, documentId, id);
  }
  for (const { id, filename } of ops.renamed) {
    await TreeService.renameDocumentFile(treeId, documentId, id, filename);
  }
  for (const f of ops.addedFiles) {
    await TreeService.addDocumentFile(
      treeId,
      documentId,
      f.filename,
      f.dataUrl,
    );
  }
  for (const link of ops.addedLinks) {
    await TreeService.addDocumentLink(
      treeId,
      documentId,
      link.url,
      link.label ?? null,
    );
  }
  return ops.removedIds.length > 0 || ops.addedFiles.length > 0;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  initialized: false,

  refreshDocuments: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ documents: [] });
      return;
    }

    const rows = await TreeService.getDocuments(treeId);

    if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight

    set({ documents: rows.map(mapDocumentFromDB), initialized: true });
  },

  getDocumentsForMember: (memberId: string) => {
    return get().documents.filter((d) => d.memberIds.includes(memberId));
  },

  addDocument: async (
    input: DocumentInput,
    memberIds: string[],
    fileOps: DocumentFileOps = NO_OPS,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return null;

    const row = await TreeService.addDocument(treeId, input, memberIds);
    const filesChanged = await applyFileOps(treeId, row.id, fileOps);

    await get().refreshDocuments(treeId);
    if (filesChanged) useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
    return mapDocumentFromDB(row);
  },

  updateDocument: async (
    id: string,
    input: DocumentInput,
    memberIds: string[],
    fileOps: DocumentFileOps = NO_OPS,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.updateDocument(treeId, id, input);
    await TreeService.setDocumentMembers(treeId, id, memberIds);
    const filesChanged = await applyFileOps(treeId, id, fileOps);

    await get().refreshDocuments(treeId);
    if (filesChanged) useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  removeDocument: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeDocument(treeId, id);
    await get().refreshDocuments(treeId);
    useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  clear: () => set({ documents: [], initialized: false }),
}));
