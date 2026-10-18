/** A reusable document: a titled record with one-or-more files (uploaded or
 *  external links) that can be linked to people, events and stories. Replaces
 *  the former Source / Citation / Evidence model. */

export type DocumentFileKind = "file" | "link";

export interface DocumentFileDB {
  id: string;
  kind: DocumentFileKind;
  filename: string | null;
  url: string;
  mime_type: string | null;
  size: number | null;
  created_at: string;
  has_text?: boolean;
  transcription_status?: DocumentFileTranscriptionStatus | null;
  transcription_error?: string | null;
}

export interface DocumentFile {
  id: string;
  kind: DocumentFileKind;
  filename: string | null;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
  /** Whether the file has a readable text; the text loads on demand. */
  hasText: boolean;
  /** The latest AI transcription run, if there was one. */
  transcriptionStatus: DocumentFileTranscriptionStatus | null;
  /** Why the latest run failed: an error code, optionally ": " and details. */
  transcriptionError: string | null;
}

/** State of a file's latest AI transcription run. */
export type DocumentFileTranscriptionStatus = "pending" | "done" | "failed";

/** Where a file's text came from. */
export type DocumentFileTextSource = "manual" | "ai";

/** The Markdown text of one uploaded file, in the file's own language. */
export interface DocumentFileTextDB {
  document_file_id: string;
  language: string | null;
  markdown: string;
  source: DocumentFileTextSource;
  machine_markdown?: string | null;
  provider?: string | null;
  model?: string | null;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentFileText {
  fileId: string;
  language: string | null;
  markdown: string;
  source: DocumentFileTextSource;
  /** The last AI transcription, unedited. */
  machineMarkdown: string | null;
  provider: string | null;
  model: string | null;
  editedBy: string | null;
  editedAt: string | null;
  updatedAt: string;
}

export interface DocumentDB {
  id: string;
  title: string;
  description: string | null;
  document_date: string | null;
  created_at: string;
  updated_at: string;
  files?: DocumentFileDB[];
  member_ids?: string[];
  event_ids?: string[];
  story_ids?: string[];
}

export interface Document {
  id: string;
  title: string;
  description: string | null;
  documentDate: string | null;
  createdAt: string;
  updatedAt: string;
  files: DocumentFile[];
  memberIds: string[];
  eventIds: string[];
  storyIds: string[];
}

/** Editable document fields captured by the dialog form. */
export interface DocumentInput {
  title: string;
  description: string;
  documentDate: string;
}

/** A file the user picked but hasn't uploaded yet. Keeping the browser File
 * reference avoids materialising a base64 copy in React state. */
export interface NewDocumentFile {
  filename: string;
  file: File;
}

/** The file changes to apply when saving a document. Mirrors the old
 *  `EvidenceOps` shape so the file-editor UI can be reused directly. */
export interface DocumentFileOps {
  addedFiles: NewDocumentFile[];
  addedLinks: { url: string; label?: string }[];
  removedIds: string[];
  renamed: { id: string; filename: string }[];
}

/** A file streamed to the staging area, returned by the upload endpoint and
 *  referenced by id when the document save attaches it. */
export interface DocumentUploadDB {
  id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
}

/** The full, atomic document change sent to the backend in one request. Files
 *  are streamed to staging first and referenced here by `attached_upload_ids`.
 *  Every add carries a client-generated `id` so a replayed request applies at
 *  most once — retries are idempotent. */
export interface DocumentSavePayload {
  title: string;
  description: string | null;
  document_date: string | null;
  member_ids: string[];
  attached_upload_ids: string[];
  added_links: { id: string; url: string; filename: string | null }[];
  removed_file_ids: string[];
  renamed_files: { id: string; filename: string }[];
}

export function mapDocumentFileFromDB(row: DocumentFileDB): DocumentFile {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    url: row.url,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
    hasText: row.has_text ?? false,
    transcriptionStatus: row.transcription_status ?? null,
    transcriptionError: row.transcription_error ?? null,
  };
}

export function mapDocumentFileTextFromDB(
  row: DocumentFileTextDB,
): DocumentFileText {
  return {
    fileId: row.document_file_id,
    language: row.language,
    markdown: row.markdown,
    source: row.source,
    machineMarkdown: row.machine_markdown ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
    updatedAt: row.updated_at,
  };
}

export function mapDocumentFromDB(row: DocumentDB): Document {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    documentDate: row.document_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: (row.files ?? []).map(mapDocumentFileFromDB),
    memberIds: row.member_ids ?? [],
    eventIds: row.event_ids ?? [],
    storyIds: row.story_ids ?? [],
  };
}
