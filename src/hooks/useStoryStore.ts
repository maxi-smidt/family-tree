import { create } from "zustand";
import { Story, StoryInput, mapStoryFromDB } from "@/types/story";
import { DatabaseService } from "@/services/DatabaseService";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";

interface StoryState {
  stories: Story[];
  refreshStories: () => Promise<void>;
  getStoriesByMember: (memberId: string) => Story[];
  addStory: (memberIds: string[], story: StoryInput) => Promise<void>;
  updateStory: (
    id: string,
    story: StoryInput,
    memberIds: string[],
  ) => Promise<void>;
  removeStory: (id: string) => Promise<void>;
}

export const useStoryStore = create<StoryState>((set, get) => ({
  stories: [],

  refreshStories: async () => {
    const db = useDatabaseStore.getState().db;
    if (!db) {
      set({ stories: [] });
      return;
    }

    const storiesResult = await DatabaseService.getStories(db);
    const linksResult = await DatabaseService.getStoryMemberLinks(db);

    const stories = storiesResult.map((row) => {
      const linkedMemberIds = linksResult
        .filter((link) => link.story_id === row.id)
        .map((link) => link.member_id);
      return mapStoryFromDB(row, linkedMemberIds);
    });

    set({ stories });
  },

  getStoriesByMember: (memberId: string) => {
    return get().stories.filter((s) => s.linkedMemberIds.includes(memberId));
  },

  addStory: async (memberIds: string[], story: StoryInput) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await DatabaseService.addStory(db, id, story, now);

    // Link story to all selected members
    for (const memberId of memberIds) {
      await DatabaseService.linkStoryToMember(db, id, memberId);
    }

    await get().refreshStories();
  },

  updateStory: async (id: string, story: StoryInput, memberIds: string[]) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const now = new Date().toISOString();
    await DatabaseService.updateStory(db, id, story, now);

    // Remove old links and add new ones
    await DatabaseService.removeStoryLinks(db, id);
    for (const memberId of memberIds) {
      await DatabaseService.linkStoryToMember(db, id, memberId);
    }

    await get().refreshStories();
  },

  removeStory: async (id: string) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    await DatabaseService.removeStory(db, id);
    await get().refreshStories();
  },
}));
