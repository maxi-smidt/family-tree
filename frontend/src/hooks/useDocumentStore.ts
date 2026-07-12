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
    onFileProgress?: (uploaded: number, total: number) => void,
  ) => Promise<Document | null>;
  updateDocument: (
    id: string,
    input: DocumentInput,
    memberIds: string[],
    fileOps?: DocumentFileOps,
    onFileProgress?: (uploaded: number, total: number) => void,
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
  onFileProgress?: (uploaded: number, total: number) => void,
): Promise<boolean> {
  for (const id of ops.removedIds) {
    await TreeService.removeDocumentFile(treeId, documentId, id);
  }
  for (const { id, filename } of ops.renamed) {
    await TreeService.renameDocumentFile(treeId, documentId, id, filename);
  }
  const total = ops.addedFiles.length;
  if (total > 0) onFileProgress?.(0, total);
  for (const [i, f] of ops.addedFiles.entries()) {
    await TreeService.addDocumentFile(
      treeId,
      documentId,
      f.file,
      f.filename,
    );
    onFileProgress?.(i + 1, total);
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
    onFileProgress?: (uploaded: number, total: number) => void,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return null;

    const row = await TreeService.addDocument(treeId, input, memberIds);
    let filesChanged: boolean;
    try {
      filesChanged = await applyFileOps(
        treeId,
        row.id,
        fileOps,
        onFileProgress,
      );
    } catch (err) {
      // The metadata row is already committed, but a file upload failed (e.g. a
      // reverse proxy rejected an oversized body with 413). Roll the new
      // document back so a failed attachment never leaves a fileless orphan;
      // deleting it also cleans up any files that did upload. Best-effort — the
      // original error is surfaced to the caller regardless.
      try {
        await TreeService.removeDocument(treeId, row.id);
      } catch {
        // ignore cleanup failure; re-throw the original upload error
      }
      await get().refreshDocuments(treeId);
      invalidateActivityView();
      throw err;
    }

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
    onFileProgress?: (uploaded: number, total: number) => void,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.updateDocument(treeId, id, input);
    await TreeService.setDocumentMembers(treeId, id, memberIds);
    const filesChanged = await applyFileOps(
      treeId,
      id,
      fileOps,
      onFileProgress,
    );

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
