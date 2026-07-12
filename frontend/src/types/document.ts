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
}

export interface DocumentFile {
  id: string;
  kind: DocumentFileKind;
  filename: string | null;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
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

export function mapDocumentFileFromDB(row: DocumentFileDB): DocumentFile {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    url: row.url,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
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
