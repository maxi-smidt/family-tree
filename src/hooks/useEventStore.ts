import { create } from "zustand";
import { Event, EventInput, mapEventFromDB } from "@/types/event";
import { DatabaseService } from "@/services/DatabaseService";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";

interface EventState {
  events: Event[];
  refreshEvents: () => Promise<void>;
  getEventsByMember: (memberId: string) => Event[];
  addEvent: (memberId: string, event: EventInput) => Promise<void>;
  updateEvent: (id: string, event: EventInput) => Promise<void>;
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

    const result = await DatabaseService.getEvents(db);
    const events = result.map(mapEventFromDB);
    set({ events });
  },

  getEventsByMember: (memberId: string) => {
    return get().events.filter((e) => e.memberId === memberId);
  },

  addEvent: async (memberId: string, event: EventInput) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await DatabaseService.addEvent(db, id, memberId, event, now);
    await get().refreshEvents();
  },

  updateEvent: async (id: string, event: EventInput) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    await DatabaseService.updateEvent(db, id, event);
    await get().refreshEvents();
  },

  removeEvent: async (id: string) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    await DatabaseService.removeEvent(db, id);
    await get().refreshEvents();
  },
}));
