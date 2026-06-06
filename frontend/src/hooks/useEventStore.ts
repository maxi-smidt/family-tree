import { create } from "zustand";
import { Event, EventInput, mapEventFromDB } from "@/types/event";
import { DatabaseService } from "@/services/DatabaseService";
import { activeTreeId } from "@/hooks/useDatabaseStore";

interface EventState {
  events: Event[];
  refreshEvents: () => Promise<void>;
  getEventsByMember: (memberId: string) => Event[];
  addEvent: (memberIds: string[], event: EventInput) => Promise<void>;
  updateEvent: (
    id: string,
    event: EventInput,
    memberIds: string[],
  ) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
}

export const useEventStore = create<EventState>((set, get) => ({
  events: [],

  refreshEvents: async () => {
    const treeId = activeTreeId();
    if (!treeId) {
      set({ events: [] });
      return;
    }

    const eventsResult = await DatabaseService.getEvents(treeId);
    const linksResult = await DatabaseService.getEventMemberLinks(treeId);

    const events = eventsResult.map((row) => {
      const linkedMemberIds = linksResult
        .filter((link) => link.event_id === row.id)
        .map((link) => link.member_id);
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

    await DatabaseService.addEvent(treeId, id, event, now);

    // Link event to all selected members
    for (const memberId of memberIds) {
      await DatabaseService.linkEventToMember(treeId, id, memberId);
    }

    await get().refreshEvents();
  },

  updateEvent: async (id: string, event: EventInput, memberIds: string[]) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await DatabaseService.updateEvent(treeId, id, event);

    // Remove old links and add new ones
    await DatabaseService.removeEventLinks(treeId, id);
    for (const memberId of memberIds) {
      await DatabaseService.linkEventToMember(treeId, id, memberId);
    }

    await get().refreshEvents();
  },

  removeEvent: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await DatabaseService.removeEvent(treeId, id);
    await get().refreshEvents();
  },
}));
