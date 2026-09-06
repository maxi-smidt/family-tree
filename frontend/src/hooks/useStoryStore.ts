import { create } from "zustand";
import { Story, StoryInput, mapStoryFromDB } from "@/types/story";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

interface StoryState {
  stories: Story[];
  initialized: boolean;
  refreshStories: (workspaceId?: string) => Promise<void>;
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

  refreshStories: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ stories: [] });
      return;
    }

    const [storiesResult, linksResult] = await Promise.all([
      WorkspaceService.getStories(workspaceId),
      WorkspaceService.getStoryMemberLinks(workspaceId),
    ]);

    if (!isActiveTree(workspaceId)) return; // tree switched/disconnected mid-flight — drop stale data

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
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await WorkspaceService.addStory(workspaceId, id, story, now, memberIds);
    if (documentIds.length > 0) {
      await WorkspaceService.setStoryDocuments(workspaceId, id, documentIds);
    }

    await get().refreshStories(workspaceId);
    invalidateActivityView();
  },

  updateStory: async (
    id: string,
    story: StoryInput,
    memberIds: string[],
    documentIds?: string[],
  ) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    const now = new Date().toISOString();
    await WorkspaceService.updateStory(workspaceId, id, story, now);
    await WorkspaceService.setStoryLinks(workspaceId, id, memberIds);
    if (documentIds !== undefined) {
      await WorkspaceService.setStoryDocuments(workspaceId, id, documentIds);
    }

    await get().refreshStories(workspaceId);
    invalidateActivityView();
  },

  removeStory: async (id: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.removeStory(workspaceId, id);
    await get().refreshStories(workspaceId);
    invalidateActivityView();
  },

  setStoryDocuments: async (id: string, documentIds: string[]) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.setStoryDocuments(workspaceId, id, documentIds);
    await get().refreshStories(workspaceId);
    invalidateActivityView();
  },

  clear: () => set({ stories: [], initialized: false }),
}));
