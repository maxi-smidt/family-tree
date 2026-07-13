import { create } from "zustand";
import {
  Document,
  DocumentFileOps,
  DocumentInput,
  DocumentSavePayload,
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

/** Stream the picked files into the staging area (reporting per-file progress)
 *  and build the atomic save payload referencing them. New files are staged
 *  *before* the save runs — and the save removes old files only after it
 *  commits — so a failed save never destroys the previous version. */
async function stageAndBuildPayload(
  treeId: string,
  input: DocumentInput,
  memberIds: string[],
  ops: DocumentFileOps,
  onFileProgress?: (uploaded: number, total: number) => void,
): Promise<DocumentSavePayload> {
  const total = ops.addedFiles.length;
  if (total > 0) onFileProgress?.(0, total);
  const attachedUploadIds: string[] = [];
  for (const [i, f] of ops.addedFiles.entries()) {
    const staged = await TreeService.stageDocumentUpload(
      treeId,
      f.file,
      f.filename,
    );
    attachedUploadIds.push(staged.id);
    onFileProgress?.(i + 1, total);
  }
  return {
    title: input.title,
    description: input.description || null,
    document_date: input.documentDate || null,
    member_ids: memberIds,
    attached_upload_ids: attachedUploadIds,
    added_links: ops.addedLinks.map((l) => ({
      id: crypto.randomUUID(),
      url: l.url,
      filename: l.label ?? null,
    })),
    removed_file_ids: ops.removedIds,
    renamed_files: ops.renamed,
  };
}

/** Whether a save changes on-disk media, so callers can refresh storage usage. */
function touchesMedia(ops: DocumentFileOps): boolean {
  return ops.addedFiles.length > 0 || ops.removedIds.length > 0;
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

    // Stage the files, then create the document with its metadata, people
    // links and attachments in one atomic request. A client-generated id makes
    // a retried create upsert instead of duplicating; a failure leaves nothing
    // behind, so there is no orphaned row to roll back.
    const documentId = crypto.randomUUID();
    const payload = await stageAndBuildPayload(
      treeId,
      input,
      memberIds,
      fileOps,
      onFileProgress,
    );
    const row = await TreeService.saveDocument(treeId, documentId, payload);

    await get().refreshDocuments(treeId);
    if (touchesMedia(fileOps)) useStorageStore.getState().refreshStorageUsage();
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

    // Stage new files first, then apply the metadata, member and file changes
    // in one atomic request; old files are removed only once it commits, so a
    // failed edit leaves the previous valid document untouched.
    const payload = await stageAndBuildPayload(
      treeId,
      input,
      memberIds,
      fileOps,
      onFileProgress,
    );
    await TreeService.saveDocument(treeId, id, payload);

    await get().refreshDocuments(treeId);
    if (touchesMedia(fileOps)) useStorageStore.getState().refreshStorageUsage();
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
