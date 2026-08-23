import { create } from "zustand";
import {
  Document,
  DocumentFileOps,
  DocumentInput,
  DocumentSavePayload,
  mapDocumentFromDB,
} from "@/types/document";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

const NO_OPS: DocumentFileOps = {
  addedFiles: [],
  addedLinks: [],
  removedIds: [],
  renamed: [],
};

/** Thrown when one or more files failed to stage (network hiccup, timed-out
 *  connection, ...). Carries every failure, not just the first, so the caller
 *  can tell the user exactly which file(s) to retry. */
export class DocumentUploadError extends Error {
  failed: { index: number; filename: string }[];
  constructor(failed: { index: number; filename: string }[]) {
    super("document-upload-failed");
    this.name = "DocumentUploadError";
    this.failed = failed;
  }
}

interface DocumentState {
  documents: Document[];
  initialized: boolean;
  refreshDocuments: (workspaceId?: string) => Promise<void>;
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
 *  commits — so a failed save never destroys the previous version.
 *
 *  Every file is attempted even if an earlier one fails (a stalled connection
 *  must not silently swallow the files queued behind it) — but if any file
 *  fails, the payload is never built and a `DocumentUploadError` naming every
 *  failure is thrown instead, so a save never attaches a partial file set. */
async function stageAndBuildPayload(
  workspaceId: string,
  input: DocumentInput,
  memberIds: string[],
  ops: DocumentFileOps,
  onFileProgress?: (uploaded: number, total: number) => void,
): Promise<DocumentSavePayload> {
  const total = ops.addedFiles.length;
  if (total > 0) onFileProgress?.(0, total);
  const attachedUploadIds: string[] = [];
  const failed: { index: number; filename: string }[] = [];
  for (const [i, f] of ops.addedFiles.entries()) {
    try {
      const staged = await WorkspaceService.stageDocumentUpload(
        workspaceId,
        f.file,
        f.filename,
      );
      attachedUploadIds.push(staged.id);
    } catch {
      failed.push({ index: i, filename: f.filename });
    }
    onFileProgress?.(i + 1, total);
  }
  if (failed.length > 0) throw new DocumentUploadError(failed);
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

  refreshDocuments: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ documents: [] });
      return;
    }

    const rows = await WorkspaceService.getDocuments(workspaceId);

    if (!isActiveTree(workspaceId)) return; // tree switched/disconnected mid-flight

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
    const workspaceId = activeTreeId();
    if (!workspaceId) return null;

    // Stage the files, then create the document with its metadata, people
    // links and attachments in one atomic request. A client-generated id makes
    // a retried create upsert instead of duplicating; a failure leaves nothing
    // behind, so there is no orphaned row to roll back.
    const documentId = crypto.randomUUID();
    const payload = await stageAndBuildPayload(
      workspaceId,
      input,
      memberIds,
      fileOps,
      onFileProgress,
    );
    const row = await WorkspaceService.saveDocument(workspaceId, documentId, payload);

    await get().refreshDocuments(workspaceId);
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
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    // Stage new files first, then apply the metadata, member and file changes
    // in one atomic request; old files are removed only once it commits, so a
    // failed edit leaves the previous valid document untouched.
    const payload = await stageAndBuildPayload(
      workspaceId,
      input,
      memberIds,
      fileOps,
      onFileProgress,
    );
    await WorkspaceService.saveDocument(workspaceId, id, payload);

    await get().refreshDocuments(workspaceId);
    if (touchesMedia(fileOps)) useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  removeDocument: async (id: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.removeDocument(workspaceId, id);
    await get().refreshDocuments(workspaceId);
    useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  clear: () => set({ documents: [], initialized: false }),
}));
