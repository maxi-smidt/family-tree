import { create } from "zustand";
import { Event, EventInput, mapEventFromDB } from "@/types/event";
import { DatabaseService } from "@/services/DatabaseService";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";

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
    const db = useDatabaseStore.getState().db;
    if (!db) {
      set({ events: [] });
      return;
    }

    const eventsResult = await DatabaseService.getEvents(db);
    const linksResult = await DatabaseService.getEventMemberLinks(db);

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
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await DatabaseService.addEvent(db, id, event, now);

    // Link event to all selected members
    for (const memberId of memberIds) {
      await DatabaseService.linkEventToMember(db, id, memberId);
    }

    await get().refreshEvents();
  },

  updateEvent: async (id: string, event: EventInput, memberIds: string[]) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    await DatabaseService.updateEvent(db, id, event);

    // Remove old links and add new ones
    await DatabaseService.removeEventLinks(db, id);
    for (const memberId of memberIds) {
      await DatabaseService.linkEventToMember(db, id, memberId);
    }

    await get().refreshEvents();
  },

  removeEvent: async (id: string) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    await DatabaseService.removeEvent(db, id);
    await get().refreshEvents();
  },
}));
