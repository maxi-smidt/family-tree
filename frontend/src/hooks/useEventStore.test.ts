import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore } from "./useEventStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { EventDB } from "@/types/event";
import { Workspace } from "@/types/workspace";

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
  useEventStore.setState({ events: [] });
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useEventStore — refreshEvents", () => {
  it("clears events when no tree is selected", async () => {
    useEventStore.setState({ events: [{ id: "stale" } as never] });

    await useEventStore.getState().refreshEvents();

    expect(useEventStore.getState().events).toHaveLength(0);
    expect(WorkspaceService.getEvents).not.toHaveBeenCalled();
  });

  it("fetches and maps events from the service", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
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
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([EVENT_DB_ROW]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore.getState().refreshEvents();

    expect(useEventStore.getState().events[0].linkedMemberIds).toEqual([]);
  });
});

describe("useEventStore — addEvent", () => {
  it("calls WorkspaceService.addEvent with the correct payload then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.addEvent).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);

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
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.updateEvent).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setEventLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setEventDocuments).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);

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
    expect(WorkspaceService.setEventLinks).toHaveBeenCalledWith(TREE_ID, "ev1", [
      "m2",
    ]);
    expect(WorkspaceService.setEventDocuments).toHaveBeenCalledWith(TREE_ID, "ev1", [
      "doc-1",
    ]);
  });

  it("leaves document links unchanged when document ids are omitted", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.updateEvent).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setEventLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore
      .getState()
      .updateEvent("ev1", { eventType: "birth", date: "2001-01-01" }, ["m2"]);

    expect(WorkspaceService.setEventDocuments).not.toHaveBeenCalled();
  });
});

describe("useEventStore — setEventDocuments", () => {
  it("calls WorkspaceService.setEventDocuments then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.setEventDocuments).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore.getState().setEventDocuments("ev1", ["doc-1", "doc-2"]);

    expect(WorkspaceService.setEventDocuments).toHaveBeenCalledWith(TREE_ID, "ev1", [
      "doc-1",
      "doc-2",
    ]);
    expect(WorkspaceService.getEvents).toHaveBeenCalled();
  });
});

describe("useEventStore — removeEvent", () => {
  it("calls WorkspaceService.removeEvent then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.removeEvent).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore.getState().removeEvent("ev1");

    expect(WorkspaceService.removeEvent).toHaveBeenCalledWith(TREE_ID, "ev1");
    expect(WorkspaceService.getEvents).toHaveBeenCalled();
  });
});

describe("useEventStore — getEventsByMember", () => {
  it("returns only events linked to the requested member", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
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

describe("useEventStore — stale-write guard", () => {
  it("does not write fetched data when the tree changed mid-flight", async () => {
    let resolve!: (v: EventDB[]) => void;
    const pending = new Promise<EventDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getEvents).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    const p = useEventStore.getState().refreshEvents(TREE_ID);
    // user switches away before the fetch resolves
    useWorkspaceStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([EVENT_DB_ROW]);
    await p;

    expect(useEventStore.getState().events).toHaveLength(0); // stale data dropped
  });

  it("does not write fetched data after disconnect", async () => {
    let resolve!: (v: EventDB[]) => void;
    const pending = new Promise<EventDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getEvents).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    const p = useEventStore.getState().refreshEvents(TREE_ID);
    // user disconnects before the fetch resolves
    useWorkspaceStore.setState({ selectedTree: undefined });
    resolve([EVENT_DB_ROW]);
    await p;

    expect(useEventStore.getState().events).toHaveLength(0); // stale data dropped
  });

  it("writes data when the explicit workspaceId is still active", async () => {
    let resolve!: (v: EventDB[]) => void;
    const pending = new Promise<EventDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getEvents).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([
      { event_id: "ev1", member_id: "m1" },
    ]);
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    const p = useEventStore.getState().refreshEvents(TREE_ID);
    resolve([EVENT_DB_ROW]);
    await p;

    expect(useEventStore.getState().events).toHaveLength(1);
    expect(useEventStore.getState().events[0].id).toBe("ev1");
  });

  it("clear() empties the events slice", () => {
    useEventStore.setState({ events: [{ id: "e1" } as never] });

    useEventStore.getState().clear();

    expect(useEventStore.getState().events).toHaveLength(0);
  });
});
