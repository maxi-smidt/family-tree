export interface StoryAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}

export interface StoryAttachmentDB {
  id: string;
  filename: string;
  url: string;
  mime_type: string | null;
  size: number | null;
  created_at: string;
}

export interface Story {
  id: string;
  linkedMemberIds: string[];
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  attachments: StoryAttachment[];
}

export interface StoryDB {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  updated_at: string;
  attachments?: StoryAttachmentDB[];
}

export interface StoryInput {
  title: string;
  content: string;
}

/** A file the user picked but hasn't uploaded yet (base64 data URL). */
export interface NewAttachment {
  filename: string;
  dataUrl: string;
}

/** The attachment changes to apply when saving a story. */
export interface AttachmentOps {
  added: NewAttachment[];
  removedIds: string[];
  renamed: { id: string; filename: string }[];
}

export function mapAttachmentFromDB(a: StoryAttachmentDB): StoryAttachment {
  return {
    id: a.id,
    filename: a.filename,
    url: a.url,
    mimeType: a.mime_type ?? null,
    size: a.size ?? null,
    createdAt: a.created_at,
  };
}

export function mapStoryFromDB(row: StoryDB, linkedMemberIds: string[]): Story {
  return {
    id: row.id,
    linkedMemberIds,
    title: row.title,
    content: row.content ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: (row.attachments ?? []).map(mapAttachmentFromDB),
  };
}

export function mapStoryToDB(story: Story): StoryDB {
  return {
    id: story.id,
    title: story.title,
    content: story.content,
    created_at: story.createdAt,
    updated_at: story.updatedAt,
    attachments: story.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      url: a.url,
      mime_type: a.mimeType,
      size: a.size,
      created_at: a.createdAt,
    })),
  };
}
