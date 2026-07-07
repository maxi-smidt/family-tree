/** Shared file-attachment types used by both stories and events.
 *
 * A single generic shape backs both domains: the backend's `AttachmentOut` /
 * `AttachmentCreate` / `AttachmentUpdate` schemas (see
 * `backend/app/schemas/content.py`) are identical for `story_attachments` and
 * `event_attachments`, so the frontend types mirror that symmetry.
 */

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}

export interface AttachmentDB {
  id: string;
  filename: string;
  url: string;
  mime_type: string | null;
  size: number | null;
  created_at: string;
}

/** A file the user picked but hasn't uploaded yet (base64 data URL). */
export interface NewAttachment {
  filename: string;
  dataUrl: string;
}

/** The attachment changes to apply when saving a story or event. */
export interface AttachmentOps {
  added: NewAttachment[];
  removedIds: string[];
  renamed: { id: string; filename: string }[];
}

export function mapAttachmentFromDB(a: AttachmentDB): Attachment {
  return {
    id: a.id,
    filename: a.filename,
    url: a.url,
    mimeType: a.mime_type ?? null,
    size: a.size ?? null,
    createdAt: a.created_at,
  };
}
