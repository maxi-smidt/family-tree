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
  status?: string | null;
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
  /** A newer AI version waits next to a person's edited text. */
  aiVersionWaiting: boolean;
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
    aiVersionWaiting: row.status === "review",
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

/** Where a document search matched (#1122). */
export type DocumentSearchField = "title" | "description" | "text";

export interface DocumentSearchHitDB {
  document_id: string;
  document_title: string;
  document_date: string | null;
  field: DocumentSearchField;
  file_id: string | null;
  file_name: string | null;
  page: number | null;
  snippet: string;
  highlights: [number, number][];
  match_count: number;
  matched_words: string[];
}

export interface DocumentSearchResultDB {
  items: DocumentSearchHitDB[];
  total: number;
  truncated: boolean;
  fuzzy: boolean;
  terms: string[];
}

export interface DocumentSearchHit {
  documentId: string;
  documentTitle: string;
  documentDate: string | null;
  field: DocumentSearchField;
  fileId: string | null;
  fileName: string | null;
  page: number | null;
  /** Plain text around the match; `highlights` are `[start, end)` ranges. */
  snippet: string;
  highlights: [number, number][];
  /** Separate places in this field that match. */
  matchCount: number;
  /** Folded words that matched, to highlight them in the full text. */
  matchedWords: string[];
}

export interface DocumentSearchResult {
  hits: DocumentSearchHit[];
  /** A lower bound when `truncated`. */
  total: number;
  truncated: boolean;
  /** Nothing matched exactly; these are similar spellings. */
  fuzzy: boolean;
}

export function mapDocumentSearchResultFromDB(
  row: DocumentSearchResultDB,
): DocumentSearchResult {
  return {
    hits: row.items.map((hit) => ({
      documentId: hit.document_id,
      documentTitle: hit.document_title,
      documentDate: hit.document_date,
      field: hit.field,
      fileId: hit.file_id,
      fileName: hit.file_name,
      page: hit.page,
      snippet: hit.snippet,
      highlights: hit.highlights,
      matchCount: hit.match_count,
      matchedWords: hit.matched_words,
    })),
    total: row.total,
    truncated: row.truncated,
    fuzzy: row.fuzzy,
  };
}
