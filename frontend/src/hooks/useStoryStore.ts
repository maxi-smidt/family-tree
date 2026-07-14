import { create } from "zustand";
import { Story, StoryInput, mapStoryFromDB } from "@/types/story";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

interface StoryState {
  stories: Story[];
  initialized: boolean;
  refreshStories: (treeId?: string) => Promise<void>;
  getStoriesByMember: (memberId: string) => Story[];
  addStory: (
    memberIds: string[],
    story: StoryInput,
    documentIds?: string[],
  ) => Promise<void>;
  updateStory: (
    id: string,
    story: StoryInput,
    memberIds: string[],
    documentIds?: string[],
  ) => Promise<void>;
  removeStory: (id: string) => Promise<void>;
  setStoryDocuments: (id: string, documentIds: string[]) => Promise<void>;
  clear: () => void;
}

export const useStoryStore = create<StoryState>((set, get) => ({
  stories: [],
  initialized: false,

  refreshStories: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ stories: [] });
      return;
    }

    const [storiesResult, linksResult] = await Promise.all([
      TreeService.getStories(treeId),
      TreeService.getStoryMemberLinks(treeId),
    ]);

    if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight — drop stale data

    const linksByStory = new Map<string, string[]>();
    for (const link of linksResult) {
      linksByStory.set(
        link.story_id,
        (linksByStory.get(link.story_id) ?? []).concat(link.member_id),
      );
    }

    const stories = storiesResult.map((row) => {
      const linkedMemberIds = linksByStory.get(row.id) ?? [];
      return mapStoryFromDB(row, linkedMemberIds);
    });

    set({ stories, initialized: true });
  },

  getStoriesByMember: (memberId: string) => {
    return get().stories.filter((s) => s.linkedMemberIds.includes(memberId));
  },

  addStory: async (
    memberIds: string[],
    story: StoryInput,
    documentIds: string[] = [],
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await TreeService.addStory(treeId, id, story, now, memberIds);
    if (documentIds.length > 0) {
      await TreeService.setStoryDocuments(treeId, id, documentIds);
    }

    await get().refreshStories(treeId);
    invalidateActivityView();
  },

  updateStory: async (
    id: string,
    story: StoryInput,
    memberIds: string[],
    documentIds?: string[],
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const now = new Date().toISOString();
    await TreeService.updateStory(treeId, id, story, now);
    await TreeService.setStoryLinks(treeId, id, memberIds);
    if (documentIds !== undefined) {
      await TreeService.setStoryDocuments(treeId, id, documentIds);
    }

    await get().refreshStories(treeId);
    invalidateActivityView();
  },

  removeStory: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeStory(treeId, id);
    await get().refreshStories(treeId);
    invalidateActivityView();
  },

  setStoryDocuments: async (id: string, documentIds: string[]) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.setStoryDocuments(treeId, id, documentIds);
    await get().refreshStories(treeId);
    invalidateActivityView();
  },

  clear: () => set({ stories: [], initialized: false }),
}));
