import { create } from "zustand";
import { Story, StoryInput, mapStoryFromDB } from "@/types/story";
import { DatabaseService } from "@/services/DatabaseService";
import { activeTreeId } from "@/hooks/useDatabaseStore";

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
    const treeId = activeTreeId();
    if (!treeId) {
      set({ stories: [] });
      return;
    }

    const storiesResult = await DatabaseService.getStories(treeId);
    const linksResult = await DatabaseService.getStoryMemberLinks(treeId);

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
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await DatabaseService.addStory(treeId, id, story, now);

    // Link story to all selected members
    for (const memberId of memberIds) {
      await DatabaseService.linkStoryToMember(treeId, id, memberId);
    }

    await get().refreshStories();
  },

  updateStory: async (id: string, story: StoryInput, memberIds: string[]) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const now = new Date().toISOString();
    await DatabaseService.updateStory(treeId, id, story, now);

    // Remove old links and add new ones
    await DatabaseService.removeStoryLinks(treeId, id);
    for (const memberId of memberIds) {
      await DatabaseService.linkStoryToMember(treeId, id, memberId);
    }

    await get().refreshStories();
  },

  removeStory: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await DatabaseService.removeStory(treeId, id);
    await get().refreshStories();
  },
}));
