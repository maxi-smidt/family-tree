import { contentOriginArgs } from "@/hooks/contentOrigin";
import { create } from "zustand";
import {
  Document,
  DocumentFile,
  DocumentFileOps,
  DocumentFileText,
  DocumentFileTranscriptionStatus,
  DocumentInput,
  DocumentSavePayload,
  DocumentSearchResult,
  mapDocumentFileTextFromDB,
  mapDocumentFromDB,
  mapDocumentSearchResultFromDB,
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

/** A document to bring into view, e.g. picked from a search result: the
 *  Documents list expands it and, with a file, opens that file's text with
 *  the matched words highlighted. */
export interface DocumentFocus {
  documentId: string;
  fileId: string | null;
  words: string[];
}

interface DocumentState {
  documents: Document[];
  initialized: boolean;
  focus: DocumentFocus | null;
  setFocus: (focus: DocumentFocus | null) => void;
  /** Search titles, descriptions and file texts on the server (#1122). */
  searchDocuments: (
    query: string,
    limit?: number,
  ) => Promise<DocumentSearchResult | null>;
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
  /** Load one file's text on demand (`null` when it has none yet). */
  loadFileText: (
    documentId: string,
    fileId: string,
  ) => Promise<DocumentFileText | null>;
  /** Save a file's text; an empty text removes it. */
  saveFileText: (
    documentId: string,
    fileId: string,
    markdown: string,
  ) => Promise<DocumentFileText | null>;
  /** Start an AI transcription; the result arrives as an SSE event. */
  transcribeFile: (documentId: string, fileId: string) => Promise<void>;
  onTranscriptionFinished: (
    workspaceId: string,
    documentId: string,
    fileId: string,
    status: Exclude<DocumentFileTranscriptionStatus, "pending">,
    error: string | null,
  ) => void;
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
  originArgs: [] | [string] = [],
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
        ...originArgs,
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

function patchFile(
  documents: Document[],
  documentId: string,
  fileId: string,
  patch: Partial<DocumentFile>,
): { documents: Document[] } {
  return {
    documents: documents.map((d) =>
      d.id === documentId
        ? {
            ...d,
            files: d.files.map((f) =>
              f.id === fileId ? { ...f, ...patch } : f,
            ),
          }
        : d,
    ),
  };
}

let refreshVersion = 0;
let transcriptionPollTimer: ReturnType<typeof setTimeout> | undefined;

/** SSE is best effort. Reconcile pending runs even if their completion event
 * was lost, including runs that were already pending when the tree opened. */
function syncTranscriptionPolling(): void {
  const workspaceId = activeTreeId();
  const pending = useDocumentStore
    .getState()
    .documents.some((d) =>
      d.files.some((f) => f.transcriptionStatus === "pending"),
    );
  if (!workspaceId || !pending) {
    clearTimeout(transcriptionPollTimer);
    transcriptionPollTimer = undefined;
    return;
  }
  if (transcriptionPollTimer !== undefined) return;
  const timer = setTimeout(async () => {
    try {
      if (isActiveTree(workspaceId))
        await useDocumentStore.getState().refreshDocuments(workspaceId);
    } catch {
      // A transient network error must not leave a run spinning forever.
    } finally {
      if (transcriptionPollTimer === timer) transcriptionPollTimer = undefined;
      syncTranscriptionPolling();
    }
  }, 5000);
  transcriptionPollTimer = timer;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  initialized: false,
  focus: null,

  setFocus: (focus) => set({ focus }),

  searchDocuments: async (query: string, limit?: number) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return null;
    const row = await WorkspaceService.searchDocuments(
      workspaceId,
      query,
      limit,
    );
    if (!isActiveTree(workspaceId)) return null;
    return mapDocumentSearchResultFromDB(row);
  },

  refreshDocuments: async (workspaceId = activeTreeId()) => {
    const version = ++refreshVersion;
    if (!workspaceId) {
      set({ documents: [] });
      syncTranscriptionPolling();
      return;
    }

    const rows = await WorkspaceService.getDocuments(workspaceId);

    // Starting and finishing a transcription both refresh the list. A slower
    // response from the start must not replace the completed state.
    if (version !== refreshVersion || !isActiveTree(workspaceId)) return;

    set({ documents: rows.map(mapDocumentFromDB), initialized: true });
    syncTranscriptionPolling();
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

    const originArgs = contentOriginArgs(workspaceId);

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
      originArgs,
    );
    const row = await WorkspaceService.saveDocument(
      workspaceId,
      documentId,
      payload,
      ...originArgs,
    );

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

    const originArgs = contentOriginArgs(workspaceId);

    // Stage new files first, then apply the metadata, member and file changes
    // in one atomic request; old files are removed only once it commits, so a
    // failed edit leaves the previous valid document untouched.
    const payload = await stageAndBuildPayload(
      workspaceId,
      input,
      memberIds,
      fileOps,
      onFileProgress,
      originArgs,
    );
    await WorkspaceService.saveDocument(
      workspaceId,
      id,
      payload,
      ...originArgs,
    );

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

  loadFileText: async (documentId: string, fileId: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return null;
    const row = await WorkspaceService.getDocumentFileText(
      workspaceId,
      documentId,
      fileId,
    );
    return row ? mapDocumentFileTextFromDB(row) : null;
  },

  saveFileText: async (
    documentId: string,
    fileId: string,
    markdown: string,
  ) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return null;
    const row = await WorkspaceService.saveDocumentFileText(
      workspaceId,
      documentId,
      fileId,
      markdown,
    );
    // Only the file's "has text" flag changes in the list.
    set((state) =>
      patchFile(state.documents, documentId, fileId, {
        hasText: row !== null,
      }),
    );
    invalidateActivityView();
    return row ? mapDocumentFileTextFromDB(row) : null;
  },

  transcribeFile: async (documentId: string, fileId: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    const previousFile = get()
      .documents.find((d) => d.id === documentId)
      ?.files.find((f) => f.id === fileId);
    // The completion event can arrive before the POST resolves. Set pending
    // now so the request's acknowledgement cannot overwrite that result.
    ++refreshVersion;
    set((state) =>
      patchFile(state.documents, documentId, fileId, {
        transcriptionStatus: "pending",
        transcriptionError: null,
      }),
    );
    const pendingFile = get()
      .documents.find((d) => d.id === documentId)
      ?.files.find((f) => f.id === fileId);
    try {
      await WorkspaceService.transcribeDocumentFile(
        workspaceId,
        documentId,
        fileId,
      );
      if (isActiveTree(workspaceId)) syncTranscriptionPolling();
    } catch (error) {
      if (isActiveTree(workspaceId)) {
        set((state) => {
          const currentFile = state.documents
            .find((d) => d.id === documentId)
            ?.files.find((f) => f.id === fileId);
          // Restore only our optimistic state, never a newer SSE update.
          if (!pendingFile || currentFile !== pendingFile) return state;
          return patchFile(state.documents, documentId, fileId, {
            transcriptionStatus: previousFile?.transcriptionStatus ?? null,
            transcriptionError: previousFile?.transcriptionError ?? null,
          });
        });
      }
      throw error;
    }
  },

  onTranscriptionFinished: (workspaceId, documentId, fileId, status, error) => {
    if (!isActiveTree(workspaceId)) return;
    // The event already carries the final state. Apply it immediately and
    // invalidate list requests that could still contain the pending state.
    ++refreshVersion;
    set((state) =>
      patchFile(state.documents, documentId, fileId, {
        transcriptionStatus: status,
        transcriptionError: error,
        ...(status === "done" ? { hasText: true } : {}),
      }),
    );
    syncTranscriptionPolling();
  },

  clear: () => {
    ++refreshVersion;
    clearTimeout(transcriptionPollTimer);
    transcriptionPollTimer = undefined;
    set({ documents: [], initialized: false, focus: null });
  },
}));
