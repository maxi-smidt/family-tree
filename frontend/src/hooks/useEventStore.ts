import { create } from "zustand";
import { Event, EventInput, mapEventFromDB } from "@/types/event";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

interface EventState {
  events: Event[];
  initialized: boolean;
  refreshEvents: (treeId?: string) => Promise<void>;
  getEventsByMember: (memberId: string) => Event[];
  addEvent: (
    memberIds: string[],
    event: EventInput,
    documentIds?: string[],
  ) => Promise<void>;
  updateEvent: (
    id: string,
    event: EventInput,
    memberIds: string[],
    documentIds?: string[],
  ) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  setEventDocuments: (id: string, documentIds: string[]) => Promise<void>;
  clear: () => void;
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
    documentIds: string[] = [],
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await TreeService.addEvent(treeId, id, event, now, memberIds);
    if (documentIds.length > 0) {
      await TreeService.setEventDocuments(treeId, id, documentIds);
    }

    await get().refreshEvents(treeId);
    invalidateActivityView();
  },

  updateEvent: async (
    id: string,
    event: EventInput,
    memberIds: string[],
    documentIds?: string[],
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.updateEvent(treeId, id, event);
    await TreeService.setEventLinks(treeId, id, memberIds);
    if (documentIds !== undefined) {
      await TreeService.setEventDocuments(treeId, id, documentIds);
    }

    await get().refreshEvents(treeId);
    invalidateActivityView();
  },

  removeEvent: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeEvent(treeId, id);
    await get().refreshEvents(treeId);
    invalidateActivityView();
  },

  setEventDocuments: async (id: string, documentIds: string[]) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.setEventDocuments(treeId, id, documentIds);
    await get().refreshEvents(treeId);
    invalidateActivityView();
  },

  clear: () => set({ events: [], initialized: false }),
}));
