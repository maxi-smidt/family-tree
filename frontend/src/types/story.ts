export interface Story {
  id: string;
  linkedMemberIds: string[];
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  documentIds: string[];
}

export interface StoryDB {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  updated_at: string;
  document_ids?: string[];
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
    documentIds: row.document_ids ?? [],
  };
}

export function mapStoryToDB(story: Story): StoryDB {
  return {
    id: story.id,
    title: story.title,
    content: story.content,
    created_at: story.createdAt,
    updated_at: story.updatedAt,
    document_ids: story.documentIds,
  };
}
