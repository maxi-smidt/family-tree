import { create } from "zustand";
import {
  AttachmentOps,
  Story,
  StoryInput,
  mapStoryFromDB,
} from "@/types/story";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { useStorageStore } from "@/hooks/useStorageStore";

const NO_OPS: AttachmentOps = { added: [], removedIds: [], renamed: [] };

interface StoryState {
  stories: Story[];
  initialized: boolean;
  refreshStories: (treeId?: string) => Promise<void>;
  getStoriesByMember: (memberId: string) => Story[];
  addStory: (
    memberIds: string[],
    story: StoryInput,
    attachments?: AttachmentOps,
  ) => Promise<void>;
  updateStory: (
    id: string,
    story: StoryInput,
    memberIds: string[],
    attachments?: AttachmentOps,
  ) => Promise<void>;
  removeStory: (id: string) => Promise<void>;
  clear: () => void;
}

async function applyAttachmentOps(
  treeId: string,
  storyId: string,
  ops: AttachmentOps,
) {
  for (const id of ops.removedIds) {
    await TreeService.removeStoryAttachment(treeId, storyId, id);
  }
  for (const { id, filename } of ops.renamed) {
    await TreeService.updateStoryAttachment(treeId, storyId, id, filename);
  }
  for (const att of ops.added) {
    await TreeService.addStoryAttachment(
      treeId,
      storyId,
      att.filename,
      att.dataUrl,
    );
  }
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
    attachments: AttachmentOps = NO_OPS,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await TreeService.addStory(treeId, id, story, now, memberIds);

    await applyAttachmentOps(treeId, id, attachments);

    await get().refreshStories(treeId);
    if (attachments.added.length > 0)
      useStorageStore.getState().refreshStorageUsage();
  },

  updateStory: async (
    id: string,
    story: StoryInput,
    memberIds: string[],
    attachments: AttachmentOps = NO_OPS,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const now = new Date().toISOString();
    await TreeService.updateStory(treeId, id, story, now);
    await TreeService.setStoryLinks(treeId, id, memberIds);

    await applyAttachmentOps(treeId, id, attachments);

    await get().refreshStories(treeId);
    if (attachments.added.length > 0 || attachments.removedIds.length > 0)
      useStorageStore.getState().refreshStorageUsage();
  },

  removeStory: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeStory(treeId, id);
    await get().refreshStories(treeId);
    useStorageStore.getState().refreshStorageUsage();
  },

  clear: () => set({ stories: [], initialized: false }),
}));
