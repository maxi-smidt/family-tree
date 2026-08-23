import { create } from "zustand";
import { Event, EventInput, mapEventFromDB } from "@/types/event";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

interface EventState {
  events: Event[];
  initialized: boolean;
  refreshEvents: (workspaceId?: string) => Promise<void>;
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

  refreshEvents: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ events: [] });
      return;
    }

    const [eventsResult, linksResult] = await Promise.all([
      WorkspaceService.getEvents(workspaceId),
      WorkspaceService.getEventMemberLinks(workspaceId),
    ]);

    if (!isActiveTree(workspaceId)) return; // tree switched/disconnected mid-flight — drop stale data

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
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await WorkspaceService.addEvent(workspaceId, id, event, now, memberIds);
    if (documentIds.length > 0) {
      await WorkspaceService.setEventDocuments(workspaceId, id, documentIds);
    }

    await get().refreshEvents(workspaceId);
    invalidateActivityView();
  },

  updateEvent: async (
    id: string,
    event: EventInput,
    memberIds: string[],
    documentIds?: string[],
  ) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.updateEvent(workspaceId, id, event);
    await WorkspaceService.setEventLinks(workspaceId, id, memberIds);
    if (documentIds !== undefined) {
      await WorkspaceService.setEventDocuments(workspaceId, id, documentIds);
    }

    await get().refreshEvents(workspaceId);
    invalidateActivityView();
  },

  removeEvent: async (id: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.removeEvent(workspaceId, id);
    await get().refreshEvents(workspaceId);
    invalidateActivityView();
  },

  setEventDocuments: async (id: string, documentIds: string[]) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.setEventDocuments(workspaceId, id, documentIds);
    await get().refreshEvents(workspaceId);
    invalidateActivityView();
  },

  clear: () => set({ events: [], initialized: false }),
}));
