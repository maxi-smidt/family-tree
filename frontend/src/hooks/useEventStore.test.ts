import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore } from "./useEventStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { EventDB, mapEventFromDB } from "@/types/event";
import { Workspace } from "@/types/workspace";

import { testLinkedContentLifecycle } from "@/test/linkedContentStore";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-evt";

const EVENT_DB_ROW: EventDB = {
  id: "ev1",
  event_type: "birth",
  date: "2000-06-15",
  location: "Berlin",
  description: "Born in Berlin",
  created_at: "2024-01-01T00:00:00Z",
};

function makeTree(): Workspace {
  return { id: TREE_ID, name: "Evt Workspace", role: "owner" };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEventStore.getState().clear();
  useWorkspaceStore.setState({ selectedTree: makeTree() });
  vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);
});

describe("useEventStore — refreshEvents", () => {
  it("fetches and maps events from the service", async () => {
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([EVENT_DB_ROW]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([
      { event_id: "ev1", member_id: "m1" },
    ]);

    await useEventStore.getState().refreshEvents();

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("ev1");
    expect(events[0].eventType).toBe("birth");
    expect(events[0].date).toBe("2000-06-15");
    expect(events[0].linkedMemberIds).toEqual(["m1"]);
  });

  it("maps empty member links when no links exist for an event", async () => {
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([EVENT_DB_ROW]);

    await useEventStore.getState().refreshEvents();

    expect(useEventStore.getState().events[0].linkedMemberIds).toEqual([]);
  });
});

describe("useEventStore — addEvent", () => {
  it("calls WorkspaceService.addEvent with the correct payload then refreshes", async () => {
    vi.mocked(WorkspaceService.addEvent).mockResolvedValue(undefined);

    await useEventStore.getState().addEvent(["m1"], {
      eventType: "marriage",
      date: "2020-09-01",
      location: "Hamburg",
      description: null,
    });

    expect(WorkspaceService.addEvent).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String), // generated uuid
      expect.objectContaining({ eventType: "marriage", date: "2020-09-01" }),
      expect.any(String), // iso timestamp
      ["m1"],
    );
    expect(WorkspaceService.getEvents).toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    useWorkspaceStore.setState({ selectedTree: undefined });
    await useEventStore.getState().addEvent([], {
      eventType: "death",
      date: "2023-03-10",
      location: null,
      description: null,
    });

    expect(WorkspaceService.addEvent).not.toHaveBeenCalled();
  });
});

describe("useEventStore — updateEvent", () => {
  it("calls WorkspaceService.updateEvent, setEventLinks and setEventDocuments then refreshes", async () => {
    vi.mocked(WorkspaceService.updateEvent).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setEventLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setEventDocuments).mockResolvedValue(undefined);

    await useEventStore.getState().updateEvent(
      "ev1",
      {
        eventType: "birth",
        date: "2001-01-01",
        location: null,
        description: null,
      },
      ["m2"],
      ["doc-1"],
    );

    expect(WorkspaceService.updateEvent).toHaveBeenCalledWith(
      TREE_ID,
      "ev1",
      expect.objectContaining({ eventType: "birth" }),
    );
    expect(WorkspaceService.setEventLinks).toHaveBeenCalledWith(
      TREE_ID,
      "ev1",
      ["m2"],
    );
    expect(WorkspaceService.setEventDocuments).toHaveBeenCalledWith(
      TREE_ID,
      "ev1",
      ["doc-1"],
    );
    expect(WorkspaceService.getEvents).toHaveBeenCalledWith(TREE_ID);
  });

  it.each([
    { label: "omitted", documentIds: undefined },
    { label: "explicitly cleared", documentIds: [] },
  ])("handles $label document links", async ({ documentIds }) => {
    await useEventStore
      .getState()
      .updateEvent(
        "ev1",
        { eventType: "birth", date: "2001-01-01" },
        ["m2"],
        documentIds,
      );

    if (documentIds === undefined) {
      expect(WorkspaceService.setEventDocuments).not.toHaveBeenCalled();
    } else {
      expect(WorkspaceService.setEventDocuments).toHaveBeenCalledWith(
        TREE_ID,
        "ev1",
        [],
      );
    }
    expect(WorkspaceService.getEvents).toHaveBeenCalledWith(TREE_ID);
  });
});

describe("useEventStore — setEventDocuments", () => {
  it("calls WorkspaceService.setEventDocuments then refreshes", async () => {
    vi.mocked(WorkspaceService.setEventDocuments).mockResolvedValue(undefined);

    await useEventStore.getState().setEventDocuments("ev1", ["doc-1", "doc-2"]);

    expect(WorkspaceService.setEventDocuments).toHaveBeenCalledWith(
      TREE_ID,
      "ev1",
      ["doc-1", "doc-2"],
    );
    expect(WorkspaceService.getEvents).toHaveBeenCalled();
  });
});

describe("useEventStore — removeEvent", () => {
  it("calls WorkspaceService.removeEvent then refreshes", async () => {
    vi.mocked(WorkspaceService.removeEvent).mockResolvedValue(undefined);

    await useEventStore.getState().removeEvent("ev1");

    expect(WorkspaceService.removeEvent).toHaveBeenCalledWith(TREE_ID, "ev1");
    expect(WorkspaceService.getEvents).toHaveBeenCalled();
  });
});

describe("useEventStore — getEventsByMember", () => {
  it("returns only events linked to the requested member", async () => {
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([
      EVENT_DB_ROW,
      { ...EVENT_DB_ROW, id: "ev2", event_type: "death" },
    ]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([
      { event_id: "ev1", member_id: "m1" },
      { event_id: "ev2", member_id: "m2" },
    ]);

    await useEventStore.getState().refreshEvents();

    const result = useEventStore.getState().getEventsByMember("m1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ev1");
  });
});

testLinkedContentLifecycle({
  name: "useEventStore",
  workspace: makeTree(),
  row: EVENT_DB_ROW,
  fetchRows: vi.mocked(WorkspaceService.getEvents),
  refresh: (id) => useEventStore.getState().refreshEvents(id),
  items: () => useEventStore.getState().events,
  initialized: () => useEventStore.getState().initialized,
  seed: () =>
    useEventStore.setState({
      events: [mapEventFromDB(EVENT_DB_ROW, [])],
      initialized: true,
    }),
  clear: () => useEventStore.getState().clear(),
});
