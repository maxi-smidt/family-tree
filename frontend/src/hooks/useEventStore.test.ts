import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore } from "./useEventStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { EventDB } from "@/types/event";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");

const TREE_ID = "tree-evt";

const EVENT_DB_ROW: EventDB = {
  id: "ev1",
  event_type: "birth",
  date: "2000-06-15",
  location: "Berlin",
  description: "Born in Berlin",
  created_at: "2024-01-01T00:00:00Z",
};

function makeTree(): Tree {
  return { id: TREE_ID, name: "Evt Tree", role: "owner" };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEventStore.setState({ events: [] });
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useEventStore — refreshEvents", () => {
  it("clears events when no tree is selected", async () => {
    useEventStore.setState({ events: [{ id: "stale" } as never] });

    await useEventStore.getState().refreshEvents();

    expect(useEventStore.getState().events).toHaveLength(0);
    expect(TreeService.getEvents).not.toHaveBeenCalled();
  });

  it("fetches and maps events from the service", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.getEvents).mockResolvedValue([EVENT_DB_ROW]);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([
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
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.getEvents).mockResolvedValue([EVENT_DB_ROW]);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore.getState().refreshEvents();

    expect(useEventStore.getState().events[0].linkedMemberIds).toEqual([]);
  });
});

describe("useEventStore — addEvent", () => {
  it("calls TreeService.addEvent with the correct payload then refreshes", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.addEvent).mockResolvedValue(undefined);
    vi.mocked(TreeService.getEvents).mockResolvedValue([]);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore.getState().addEvent(["m1"], {
      eventType: "marriage",
      date: "2020-09-01",
      location: "Hamburg",
      description: null,
    });

    expect(TreeService.addEvent).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String), // generated uuid
      expect.objectContaining({ eventType: "marriage", date: "2020-09-01" }),
      expect.any(String), // iso timestamp
      ["m1"],
    );
    expect(TreeService.getEvents).toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    await useEventStore.getState().addEvent([], {
      eventType: "death",
      date: "2023-03-10",
      location: null,
      description: null,
    });

    expect(TreeService.addEvent).not.toHaveBeenCalled();
  });
});

describe("useEventStore — updateEvent", () => {
  it("calls TreeService.updateEvent and setEventLinks then refreshes", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.updateEvent).mockResolvedValue(undefined);
    vi.mocked(TreeService.setEventLinks).mockResolvedValue(undefined);
    vi.mocked(TreeService.getEvents).mockResolvedValue([]);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore.getState().updateEvent(
      "ev1",
      {
        eventType: "birth",
        date: "2001-01-01",
        location: null,
        description: null,
      },
      ["m2"],
    );

    expect(TreeService.updateEvent).toHaveBeenCalledWith(
      TREE_ID,
      "ev1",
      expect.objectContaining({ eventType: "birth" }),
    );
    expect(TreeService.setEventLinks).toHaveBeenCalledWith(TREE_ID, "ev1", [
      "m2",
    ]);
  });
});

describe("useEventStore — removeEvent", () => {
  it("calls TreeService.removeEvent then refreshes", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.removeEvent).mockResolvedValue(undefined);
    vi.mocked(TreeService.getEvents).mockResolvedValue([]);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);

    await useEventStore.getState().removeEvent("ev1");

    expect(TreeService.removeEvent).toHaveBeenCalledWith(TREE_ID, "ev1");
    expect(TreeService.getEvents).toHaveBeenCalled();
  });
});

describe("useEventStore — getEventsByMember", () => {
  it("returns only events linked to the requested member", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.getEvents).mockResolvedValue([
      EVENT_DB_ROW,
      { ...EVENT_DB_ROW, id: "ev2", event_type: "death" },
    ]);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([
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
    vi.mocked(TreeService.getEvents).mockReturnValue(pending);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);
    useTreeStore.setState({ selectedTree: makeTree() });

    const p = useEventStore.getState().refreshEvents(TREE_ID);
    // user switches away before the fetch resolves
    useTreeStore.setState({
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
    vi.mocked(TreeService.getEvents).mockReturnValue(pending);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);
    useTreeStore.setState({ selectedTree: makeTree() });

    const p = useEventStore.getState().refreshEvents(TREE_ID);
    // user disconnects before the fetch resolves
    useTreeStore.setState({ selectedTree: undefined });
    resolve([EVENT_DB_ROW]);
    await p;

    expect(useEventStore.getState().events).toHaveLength(0); // stale data dropped
  });

  it("writes data when the explicit treeId is still active", async () => {
    let resolve!: (v: EventDB[]) => void;
    const pending = new Promise<EventDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(TreeService.getEvents).mockReturnValue(pending);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([
      { event_id: "ev1", member_id: "m1" },
    ]);
    useTreeStore.setState({ selectedTree: makeTree() });

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
