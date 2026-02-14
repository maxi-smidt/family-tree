import { create } from "zustand";
import { Story, StoryInput, mapStoryFromDB } from "@/types/story";
import { DatabaseService } from "@/services/DatabaseService";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";

interface StoryState {
  stories: Story[];
  refreshStories: () => Promise<void>;
  getStoriesByMember: (memberId: string) => Story[];
  addStory: (memberId: string, story: StoryInput) => Promise<void>;
  updateStory: (id: string, story: StoryInput) => Promise<void>;
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

    const result = await DatabaseService.getStories(db);
    const stories = result.map(mapStoryFromDB);
    set({ stories });
  },

  getStoriesByMember: (memberId: string) => {
    return get().stories.filter((s) => s.memberId === memberId);
  },

  addStory: async (memberId: string, story: StoryInput) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await DatabaseService.addStory(db, id, memberId, story, now);
    await get().refreshStories();
  },

  updateStory: async (id: string, story: StoryInput) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const now = new Date().toISOString();
    await DatabaseService.updateStory(db, id, story, now);
    await get().refreshStories();
  },

  removeStory: async (id: string) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    await DatabaseService.removeStory(db, id);
    await get().refreshStories();
  },
}));
