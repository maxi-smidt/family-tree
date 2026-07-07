import {
  Attachment,
  AttachmentDB,
  mapAttachmentFromDB,
} from "@/types/attachment";

export type { NewAttachment, AttachmentOps } from "@/types/attachment";
export { mapAttachmentFromDB } from "@/types/attachment";

/** @deprecated use `Attachment` from `@/types/attachment` — kept as an alias
 * so existing story-specific imports keep working. */
export type StoryAttachment = Attachment;

/** @deprecated use `AttachmentDB` from `@/types/attachment` — kept as an
 * alias so existing story-specific imports keep working. */
export type StoryAttachmentDB = AttachmentDB;

export interface Story {
  id: string;
  linkedMemberIds: string[];
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
}

export interface StoryDB {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  updated_at: string;
  attachments?: AttachmentDB[];
}

export interface StoryInput {
  title: string;
  content: string;
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
