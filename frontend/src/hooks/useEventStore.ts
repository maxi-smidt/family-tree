import { create } from "zustand";
import { Event, EventInput, mapEventFromDB } from "@/types/event";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface EventState {
  events: Event[];
  refreshEvents: (treeId?: string) => Promise<void>;
  getEventsByMember: (memberId: string) => Event[];
  addEvent: (memberIds: string[], event: EventInput) => Promise<void>;
  updateEvent: (
    id: string,
    event: EventInput,
    memberIds: string[],
  ) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  clear: () => void;
}

export const useEventStore = create<EventState>((set, get) => ({
  events: [],

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

    set({ events });
  },

  getEventsByMember: (memberId: string) => {
    return get().events.filter((e) => e.linkedMemberIds.includes(memberId));
  },

  addEvent: async (memberIds: string[], event: EventInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await TreeService.addEvent(treeId, id, event, now, memberIds);

    await get().refreshEvents(treeId);
  },

  updateEvent: async (id: string, event: EventInput, memberIds: string[]) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.updateEvent(treeId, id, event);
    await TreeService.setEventLinks(treeId, id, memberIds);

    await get().refreshEvents(treeId);
  },

  removeEvent: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeEvent(treeId, id);
    await get().refreshEvents(treeId);
  },

  clear: () => set({ events: [] }),
}));
