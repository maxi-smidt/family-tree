import { create } from "zustand";
import { Event, EventInput, mapEventFromDB } from "@/types/event";
import { AttachmentOps } from "@/types/attachment";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

const NO_OPS: AttachmentOps = { added: [], removedIds: [], renamed: [] };

interface EventState {
  events: Event[];
  initialized: boolean;
  refreshEvents: (treeId?: string) => Promise<void>;
  getEventsByMember: (memberId: string) => Event[];
  addEvent: (
    memberIds: string[],
    event: EventInput,
    attachments?: AttachmentOps,
  ) => Promise<void>;
  updateEvent: (
    id: string,
    event: EventInput,
    memberIds: string[],
    attachments?: AttachmentOps,
  ) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  clear: () => void;
}

async function applyAttachmentOps(
  treeId: string,
  eventId: string,
  ops: AttachmentOps,
) {
  for (const id of ops.removedIds) {
    await TreeService.removeEventAttachment(treeId, eventId, id);
  }
  for (const { id, filename } of ops.renamed) {
    await TreeService.updateEventAttachment(treeId, eventId, id, filename);
  }
  for (const att of ops.added) {
    await TreeService.addEventAttachment(
      treeId,
      eventId,
      att.filename,
      att.dataUrl,
    );
  }
}

export const useEventStore = create<EventState>((set, get) => ({
  events: [],
  initialized: false,

  refreshEvents: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ events: [] });
      return;
    }

    const [eventsResult, linksResult] = await Promise.all([
      TreeService.getEvents(treeId),
      TreeService.getEventMemberLinks(treeId),
    ]);

    if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight — drop stale data

    const linksByEvent = new Map<string, string[]>();
    for (const link of linksResult) {
      linksByEvent.set(
        link.event_id,
        (linksByEvent.get(link.event_id) ?? []).concat(link.member_id),
      );
    }

    const events = eventsResult.map((row) => {
      const linkedMemberIds = linksByEvent.get(row.id) ?? [];
      return mapEventFromDB(row, linkedMemberIds);
    });

    set({ events, initialized: true });
  },

  getEventsByMember: (memberId: string) => {
    return get().events.filter((e) => e.linkedMemberIds.includes(memberId));
  },

  addEvent: async (
    memberIds: string[],
    event: EventInput,
    attachments: AttachmentOps = NO_OPS,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await TreeService.addEvent(treeId, id, event, now, memberIds);

    await applyAttachmentOps(treeId, id, attachments);

    await get().refreshEvents(treeId);
    if (attachments.added.length > 0)
      useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  updateEvent: async (
    id: string,
    event: EventInput,
    memberIds: string[],
    attachments: AttachmentOps = NO_OPS,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.updateEvent(treeId, id, event);
    await TreeService.setEventLinks(treeId, id, memberIds);

    await applyAttachmentOps(treeId, id, attachments);

    await get().refreshEvents(treeId);
    if (attachments.added.length > 0 || attachments.removedIds.length > 0)
      useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  removeEvent: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeEvent(treeId, id);
    await get().refreshEvents(treeId);
    useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  clear: () => set({ events: [], initialized: false }),
}));
