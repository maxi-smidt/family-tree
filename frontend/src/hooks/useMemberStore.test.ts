import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "./useMemberStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useEventStore } from "./useEventStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { ApiError } from "@/services/api";
import { treeProcessorClient } from "@/workers/treeProcessorClient";
import { MemberDB } from "@/types/member";
import { Workspace } from "@/types/workspace";
import { toast } from "sonner";

vi.mock("@/services/WorkspaceService");
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

const TREE_ID = "tree-abc";

const MEMBER_DB_ROW: MemberDB = {
  id: "m1",
  gender: "m",
  academicTitle: null,
  firstName: "John",
  lastName: "Doe",
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  dateOfBirth: "1980-01-01",
  dateOfDeath: null,
  deceased: false,
  adopted: false,
  additionalData: null,
  isCollapsed: 0,
  positionX: 0,
  positionY: 0,
};

function makeTree(role: "owner" | "editor" | "viewer" = "owner"): Workspace {
  return { id: TREE_ID, name: "Test Workspace", role };
}

function selectTree(role: "owner" | "editor" | "viewer" = "owner") {
  useWorkspaceStore.setState({ selectedTree: makeTree(role) });
}

function mockServiceEmpty() {
  vi.mocked(WorkspaceService.getMembers).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);
}

function mockServiceWithMember() {
  vi.mocked(WorkspaceService.getMembers).mockResolvedValue([MEMBER_DB_ROW]);
  vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  useMemberStore.setState({
    members: [],
    detailLoadedIds: new Set<string>(),
    undoStack: [],
    redoStack: [],
    windowed: false,
    windowedForTreeId: null,
    focusRootId: null,
    focusSectionIds: null,
    neighborhoodUp: 3,
    neighborhoodDown: 3,
    neighborhoodPartners: true,
    activeSavedViewId: null,
    savedViewPositions: [],
    savedViewFilters: {},
    neighborhoodMemberRows: [],
    neighborhoodRelations: [],
    neighborhoodCursor: null,
    continuations: [],
    totalMemberCount: 0,
  });
  useEventStore.setState({ events: [], initialized: false });
  useWorkspaceStore.setState({ selectedTree: undefined });
  // syncVitalEvent calls the event store which uses these service methods
  vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);
  vi.mocked(WorkspaceService.addEvent).mockResolvedValue(undefined);
  // Default: below the windowed threshold, so refreshMembers() falls through
  // to the full load below after probing. Tests exercising the windowed path
  // override this with mockResolvedValueOnce.
  vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValue({
    members: [],
    relations: [],
    root_id: "",
    truncated: false,
    total_member_count: 0,
  });
});

describe("useMemberStore — refreshMembers", () => {
  it("clears members when no tree is selected", async () => {
    useMemberStore.setState({ members: [{ id: "stale" } as never] });

    await useMemberStore.getState().refreshMembers();

    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(WorkspaceService.getMembers).not.toHaveBeenCalled();
  });

  it("fetches and maps members from the service", async () => {
    selectTree();
    mockServiceWithMember();

    await useMemberStore.getState().refreshMembers();

    const members = useMemberStore.getState().members;
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("m1");
    expect(members[0].firstName).toBe("John");
    expect(members[0].gender).toBe("m");
    expect(members[0].date.birth).toBe("1980-01-01");
    expect(members[0].isCollapsed).toBe(false);
    expect(WorkspaceService.getMembers).toHaveBeenCalledWith(TREE_ID, true);
  });

  it("calls getMembers and getRelations in parallel (diseases deferred to fetchMemberDetail)", async () => {
    selectTree();
    mockServiceEmpty();

    await useMemberStore.getState().refreshMembers();

    expect(WorkspaceService.getMembers).toHaveBeenCalledWith(TREE_ID, true);
    expect(WorkspaceService.getRelations).toHaveBeenCalledWith(TREE_ID);
    // getDiseases is no longer called on refreshMembers — it is deferred to fetchMemberDetail
    expect(WorkspaceService.getDiseases).not.toHaveBeenCalled();
  });

  it("probes the bounded neighborhood endpoint before ever fetching the full member/relation set", async () => {
    selectTree();
    mockServiceEmpty();

    await useMemberStore.getState().refreshMembers();

    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      undefined,
      expect.any(Number),
      expect.any(Number),
    );
    // Small workspace (below the windowed threshold): the probe alone isn't
    // enough to render the canvas, so a full load still follows.
    expect(WorkspaceService.getMembers).toHaveBeenCalledWith(TREE_ID, true);
    expect(useMemberStore.getState().windowed).toBe(false);
  });

  it("enters windowed mode straight from the probe for a large workspace, without ever fetching the full graph", async () => {
    selectTree();
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValueOnce({
      members: [MEMBER_DB_ROW],
      relations: [],
      root_id: "m1",
      truncated: true,
      total_member_count: 5_000,
    });

    await useMemberStore.getState().refreshMembers();

    expect(WorkspaceService.getMembers).not.toHaveBeenCalled();
    expect(WorkspaceService.getRelations).not.toHaveBeenCalled();
    const state = useMemberStore.getState();
    expect(state.windowed).toBe(true);
    expect(state.totalMemberCount).toBe(5_000);
    expect(state.members).toHaveLength(1);
  });

  it("discards a stale in-flight refresh when a newer one has already committed", async () => {
    selectTree();
    let resolveFirst: (value: {
      members: never[];
      relations: never[];
      root_id: string;
      truncated: boolean;
      total_member_count: number;
    }) => void = () => {};
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(WorkspaceService.getNeighborhood)
      .mockReturnValueOnce(first as never)
      .mockResolvedValueOnce({
        members: [MEMBER_DB_ROW],
        relations: [],
        root_id: "m1",
        truncated: true,
        total_member_count: 5_000,
      });

    const firstCall = useMemberStore.getState().refreshMembers();
    const secondCall = useMemberStore.getState().refreshMembers();
    await secondCall;
    expect(useMemberStore.getState().totalMemberCount).toBe(5_000);

    resolveFirst({
      members: [],
      relations: [],
      root_id: "",
      truncated: false,
      total_member_count: 1,
    });
    await firstCall;

    // The slower, superseded first call must not overwrite what the second
    // (later) call already committed.
    expect(useMemberStore.getState().totalMemberCount).toBe(5_000);
  });

  it("does not fall back to a full load for a stale probe failure", async () => {
    selectTree();
    let rejectFirst: (reason: unknown) => void = () => {};
    const first = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    vi.mocked(WorkspaceService.getNeighborhood)
      .mockReturnValueOnce(first as never)
      .mockResolvedValueOnce({
        members: [MEMBER_DB_ROW],
        relations: [],
        root_id: "m1",
        truncated: true,
        total_member_count: 5_000,
      });

    const firstCall = useMemberStore.getState().refreshMembers();
    const secondCall = useMemberStore.getState().refreshMembers();
    await secondCall;
    expect(useMemberStore.getState().totalMemberCount).toBe(5_000);

    // The superseded first call's probe now fails. It must not start the
    // O(workspace) full-load fallback — that fetch's result would just be
    // discarded, but the fetch itself is exactly what this change removes.
    rejectFirst(new Error("network error"));
    await firstCall;

    expect(WorkspaceService.getMembers).not.toHaveBeenCalled();
    expect(WorkspaceService.getRelations).not.toHaveBeenCalled();
    expect(useMemberStore.getState().totalMemberCount).toBe(5_000);
  });
});

describe("useMemberStore — inline expansion (#989)", () => {
  const MEMBER_2: MemberDB = { ...MEMBER_DB_ROW, id: "m2", firstName: "Jane" };

  beforeEach(() => {
    selectTree();
    vi.mocked(WorkspaceService.updateMemberPositions).mockResolvedValue(
      undefined,
    );
    useMemberStore.setState({
      windowed: true,
      windowedForTreeId: TREE_ID,
      focusRootId: "m1",
      focusSectionIds: null,
      neighborhoodUp: 3,
      neighborhoodDown: 3,
      neighborhoodMemberRows: [MEMBER_DB_ROW],
      neighborhoodRelations: [],
      neighborhoodCursor: "cursor-1",
      continuations: [
        { section_id: null, section_name: null, remaining_count: 1 },
      ],
    });
  });

  it("focusSection scopes the neighborhood fetch to the given section and replaces the buffers", async () => {
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValueOnce({
      members: [MEMBER_2],
      relations: [],
      root_id: "m2",
      truncated: false,
      total_member_count: 1,
    });

    await useMemberStore.getState().focusSection("sec-1");

    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      undefined,
      3,
      3,
      true,
      ["sec-1"],
    );
    const state = useMemberStore.getState();
    expect(state.focusSectionIds).toEqual(["sec-1"]);
    // A fresh focus/scope change replaces the accumulated buffer rather than
    // merging into whatever was there before.
    expect(state.neighborhoodMemberRows).toEqual([MEMBER_2]);
    expect(state.members).toHaveLength(1);
    expect(state.members[0].id).toBe("m2");
  });

  it("expandGeneration merges the deeper page into the existing members instead of replacing them", async () => {
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValueOnce({
      members: [MEMBER_2],
      relations: [],
      root_id: "m1",
      truncated: false,
      total_member_count: 2,
      next_cursor: null,
      continuations: [],
    });

    await useMemberStore.getState().expandGeneration();

    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      "m1",
      4,
      4,
      true,
      undefined,
    );
    const state = useMemberStore.getState();
    expect(state.neighborhoodUp).toBe(4);
    expect(state.neighborhoodDown).toBe(4);
    const ids = state.members.map((m) => m.id).sort();
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("loadMoreNeighborhood replays the stored cursor and merges the next page", async () => {
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValueOnce({
      members: [MEMBER_2],
      relations: [],
      root_id: "m1",
      truncated: false,
      total_member_count: 2,
      next_cursor: "cursor-2",
      continuations: [],
    });

    await useMemberStore.getState().loadMoreNeighborhood();

    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      "m1",
      3,
      3,
      true,
      undefined,
      undefined,
      "cursor-1",
    );
    const state = useMemberStore.getState();
    expect(state.neighborhoodCursor).toBe("cursor-2");
    expect(state.members.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("drops the cursor and continuations on a stale-cursor (409) response instead of retrying", async () => {
    vi.mocked(WorkspaceService.getNeighborhood).mockRejectedValueOnce(
      new ApiError(409, "stale_cursor"),
    );

    await useMemberStore.getState().loadMoreNeighborhood();

    const state = useMemberStore.getState();
    expect(state.neighborhoodCursor).toBeNull();
    expect(state.continuations).toEqual([]);
  });

  it("does not fetch more once the node budget is reached", async () => {
    useMemberStore.setState({
      neighborhoodMemberRows: Array.from({ length: 1_500 }, (_, i) => ({
        ...MEMBER_DB_ROW,
        id: `m${i}`,
      })),
    });

    await useMemberStore.getState().loadMoreNeighborhood();
    await useMemberStore.getState().expandGeneration();

    expect(WorkspaceService.getNeighborhood).not.toHaveBeenCalled();
  });

  it("caps the merged buffer at the node budget instead of letting one page overshoot it", async () => {
    const existingRows = Array.from({ length: 1_000 }, (_, i) => ({
      ...MEMBER_DB_ROW,
      id: `existing-${i}`,
    }));
    useMemberStore.setState({ neighborhoodMemberRows: existingRows });
    // A single page can return up to the backend's own per-page ceiling
    // (1,500) regardless of how much is already accumulated — merging it
    // in naively would land at 2,500, well past the advertised cap.
    const newRows = Array.from({ length: 1_500 }, (_, i) => ({
      ...MEMBER_DB_ROW,
      id: `new-${i}`,
    }));
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValueOnce({
      members: newRows,
      relations: [],
      root_id: "m1",
      truncated: true,
      total_member_count: 10_000,
      next_cursor: "cursor-2",
      continuations: [],
    });
    // Above SYNC_LAYOUT_THRESHOLD, computeLayout offloads to a real Web
    // Worker, which jsdom doesn't provide — stub it so this test exercises
    // the capping logic, not worker availability.
    const layoutSpy = vi
      .spyOn(treeProcessorClient, "computeLayout")
      .mockResolvedValue({});

    try {
      await useMemberStore.getState().loadMoreNeighborhood();
    } finally {
      layoutSpy.mockRestore();
    }

    const state = useMemberStore.getState();
    expect(state.neighborhoodMemberRows).toHaveLength(1_500);
    expect(state.members).toHaveLength(1_500);
    // Every already-accumulated row survives the cap; only the tail of the
    // newly-fetched page is dropped.
    expect(
      existingRows.every((r) => state.neighborhoodMemberRows.includes(r)),
    ).toBe(true);
  });

  it("resetNeighborhood clears the accumulated buffers and refetches a fresh baseline page", async () => {
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValueOnce({
      members: [MEMBER_DB_ROW],
      relations: [],
      root_id: "m1",
      truncated: false,
      total_member_count: 1,
    });

    await useMemberStore.getState().resetNeighborhood();

    const state = useMemberStore.getState();
    expect(state.neighborhoodMemberRows).toEqual([MEMBER_DB_ROW]);
    expect(state.continuations).toEqual([]);
  });
});

describe("useMemberStore — addMember", () => {
  it("calls WorkspaceService.addMember then refreshes", async () => {
    selectTree();
    vi.mocked(WorkspaceService.addMember).mockResolvedValue(undefined);
    mockServiceEmpty();

    const newMember = {
      id: "m2",
      gender: "f" as const,
      academicTitle: null,
      firstName: "Jane",
      lastName: "Doe",
      middleNames: null,
      baptismalName: null,
      maidenName: null,
      imageData: null,
      date: { birth: "1990-01-01", death: null },
      deceased: false,
      adopted: false,
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      cemetery: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(newMember);

    expect(WorkspaceService.addMember).toHaveBeenCalledWith(
      TREE_ID,
      expect.objectContaining({ id: "m2" }),
    );
    expect(WorkspaceService.getMembers).toHaveBeenCalled();
  });

  it("adds a history entry after addMember", async () => {
    selectTree();
    vi.mocked(WorkspaceService.addMember).mockResolvedValue(undefined);
    mockServiceEmpty();

    const member = {
      id: "m3",
      gender: "m" as const,
      academicTitle: null,
      firstName: "Bob",
      lastName: "Smith",
      middleNames: null,
      baptismalName: null,
      maidenName: null,
      imageData: null,
      date: { birth: "1970-06-15", death: null },
      deceased: false,
      adopted: false,
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      cemetery: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(member);

    expect(useMemberStore.getState().undoStack).toHaveLength(1);
    expect(useMemberStore.getState().redoStack).toHaveLength(0);
  });

  it("seeds the auto-created birth event's location from birthplace", async () => {
    selectTree();
    vi.mocked(WorkspaceService.addMember).mockResolvedValue(undefined);
    mockServiceEmpty();

    const newMember = {
      id: "m4",
      gender: "f" as const,
      academicTitle: null,
      firstName: "Ada",
      lastName: "Lovelace",
      middleNames: null,
      baptismalName: null,
      maidenName: null,
      imageData: null,
      date: { birth: "1815-12-10", death: null },
      deceased: false,
      adopted: false,
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: "London",
      hometown: null,
      cemetery: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(newMember);

    expect(WorkspaceService.addEvent).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      expect.objectContaining({
        eventType: "birth",
        date: "1815-12-10",
        location: "London",
      }),
      expect.any(String),
      ["m4"],
    );
  });
});

describe("useMemberStore — removeMember", () => {
  it("hides the member and defers the API delete until the grace period ends", async () => {
    vi.useFakeTimers();
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.removeMember).mockResolvedValue(undefined);
    mockServiceEmpty();

    await useMemberStore.getState().removeMember("m1");

    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(WorkspaceService.removeMember).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        duration: 8000,
        action: expect.objectContaining({ label: expect.any(String) }),
      }),
    );

    await vi.advanceTimersByTimeAsync(8000);

    expect(WorkspaceService.removeMember).toHaveBeenCalledWith(TREE_ID, "m1");
    expect(useMemberStore.getState().members).toHaveLength(0);
    vi.useRealTimers();
  });

  it("cancels the API delete and restores the member when undo is clicked", async () => {
    vi.useFakeTimers();
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    await useMemberStore.getState().removeMember("m1");
    await useMemberStore.getState().refreshMembers();

    expect(useMemberStore.getState().members).toHaveLength(0);

    const toastOptions = vi.mocked(toast.info).mock.calls[0]?.[1];
    const action = toastOptions?.action as unknown as { onClick: () => void };
    action.onClick();

    expect(
      useMemberStore.getState().members.map((member) => member.id),
    ).toEqual(["m1"]);
    expect(toast.dismiss).toHaveBeenCalledWith("toast-id");

    await vi.advanceTimersByTimeAsync(8000);

    expect(WorkspaceService.removeMember).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("restores the member when the deferred API delete fails", async () => {
    vi.useFakeTimers();
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.removeMember).mockRejectedValue(
      new Error("offline"),
    );

    await useMemberStore.getState().removeMember("m1");
    await vi.advanceTimersByTimeAsync(8000);

    expect(
      useMemberStore.getState().members.map((member) => member.id),
    ).toEqual(["m1"]);
    expect(toast.error).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does nothing when member is not found", async () => {
    selectTree();
    mockServiceEmpty();
    await useMemberStore.getState().refreshMembers();

    await useMemberStore.getState().removeMember("nonexistent");

    expect(WorkspaceService.removeMember).not.toHaveBeenCalled();
  });
});

describe("useMemberStore — updateMemberPartial", () => {
  it("calls WorkspaceService.updateMember with the changes then refreshes", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.updateMember).mockResolvedValue(undefined);
    mockServiceWithMember(); // refresh returns same member

    await useMemberStore
      .getState()
      .updateMemberPartial("m1", { firstName: "Johnny" });

    expect(WorkspaceService.updateMember).toHaveBeenCalledWith(
      TREE_ID,
      "m1",
      expect.objectContaining({ firstName: "Johnny" }),
    );
    expect(WorkspaceService.getMembers).toHaveBeenCalledTimes(2); // initial + after update
  });

  it("adds a history entry after updateMemberPartial", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.updateMember).mockResolvedValue(undefined);
    mockServiceWithMember();

    await useMemberStore
      .getState()
      .updateMemberPartial("m1", { lastName: "Smith" });

    expect(useMemberStore.getState().undoStack).toHaveLength(1);
  });

  it("sends a birth-date change through the atomic member update", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.updateMember).mockResolvedValue(undefined);
    mockServiceWithMember();

    await useMemberStore
      .getState()
      .updateMemberPartial("m1", { dateOfBirth: "1981-02-02" });

    expect(WorkspaceService.updateMember).toHaveBeenCalledWith(
      TREE_ID,
      "m1",
      expect.objectContaining({
        dateOfBirth: "1981-02-02",
      }),
    );
    expect(WorkspaceService.updateEvent).not.toHaveBeenCalled();
  });
});

describe("useMemberStore — optimistic mutation rollback", () => {
  it("rolls back collapsed state and reports an error when persistence fails", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.updateMemberCollapsedBulk).mockRejectedValueOnce(
      new Error("offline"),
    );
    mockServiceWithMember();

    await expect(
      useMemberStore
        .getState()
        .batchSetCollapsed([{ id: "m1", isCollapsed: true }]),
    ).rejects.toThrow("offline");

    expect(useMemberStore.getState().members[0].isCollapsed).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(WorkspaceService.getMembers).toHaveBeenCalledTimes(2);
  });

  it("rolls back member positions and skips history when persistence fails", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.updateMemberPositions).mockRejectedValueOnce(
      new Error("offline"),
    );
    mockServiceWithMember();

    await expect(
      useMemberStore.getState().persistPositions([{ id: "m1", x: 40, y: 80 }]),
    ).rejects.toThrow("offline");

    expect(useMemberStore.getState().members[0].position).toEqual({
      x: 0,
      y: 0,
    });
    expect(useMemberStore.getState().undoStack).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
    expect(WorkspaceService.getMembers).toHaveBeenCalledTimes(2);
  });
});

describe("useMemberStore — undo/redo", () => {
  it("undo triggers the stored undo action", async () => {
    selectTree();
    vi.mocked(WorkspaceService.addMember).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.removeMember).mockResolvedValue(undefined);
    mockServiceEmpty();

    const member = {
      id: "m4",
      gender: "m" as const,
      academicTitle: null,
      firstName: "Undo",
      lastName: "Test",
      middleNames: null,
      baptismalName: null,
      maidenName: null,
      imageData: null,
      date: { birth: "2000-01-01", death: null },
      deceased: false,
      adopted: false,
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      cemetery: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(member);
    expect(useMemberStore.getState().undoStack).toHaveLength(1);

    await useMemberStore.getState().undo();

    // undo of addMember calls removeMember
    expect(WorkspaceService.removeMember).toHaveBeenCalledWith(TREE_ID, "m4");
    expect(useMemberStore.getState().undoStack).toHaveLength(0);
    expect(useMemberStore.getState().redoStack).toHaveLength(1);
  });

  it("redo re-applies the action after undo", async () => {
    selectTree();
    vi.mocked(WorkspaceService.addMember).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.removeMember).mockResolvedValue(undefined);
    mockServiceEmpty();

    const member = {
      id: "m5",
      gender: "f" as const,
      academicTitle: null,
      firstName: "Redo",
      lastName: "Test",
      middleNames: null,
      baptismalName: null,
      maidenName: null,
      imageData: null,
      date: { birth: "1995-05-20", death: null },
      deceased: false,
      adopted: false,
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      cemetery: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(member);
    await useMemberStore.getState().undo();
    await useMemberStore.getState().redo();

    // redo of addMember calls addMember again
    expect(WorkspaceService.addMember).toHaveBeenCalledTimes(2);
    expect(useMemberStore.getState().redoStack).toHaveLength(0);
    expect(useMemberStore.getState().undoStack).toHaveLength(1);
  });
});

describe("useMemberStore — stale-write guard", () => {
  it("does not write fetched data when the tree changed mid-flight", async () => {
    let resolve!: (v: MemberDB[]) => void;
    const pending = new Promise<MemberDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getMembers).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    const p = useMemberStore.getState().refreshMembers(TREE_ID);
    // user switches away before the fetch resolves
    useWorkspaceStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([MEMBER_DB_ROW]);
    await p;

    expect(useMemberStore.getState().members).toHaveLength(0); // stale data dropped
  });

  it("does not write fetched data after disconnect", async () => {
    let resolve!: (v: MemberDB[]) => void;
    const pending = new Promise<MemberDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getMembers).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    const p = useMemberStore.getState().refreshMembers(TREE_ID);
    // user disconnects before the fetch resolves
    useWorkspaceStore.setState({ selectedTree: undefined });
    resolve([MEMBER_DB_ROW]);
    await p;

    expect(useMemberStore.getState().members).toHaveLength(0); // stale data dropped
  });

  it("writes data when the explicit workspaceId is still active", async () => {
    let resolve!: (v: MemberDB[]) => void;
    const pending = new Promise<MemberDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getMembers).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    const p = useMemberStore.getState().refreshMembers(TREE_ID);
    resolve([MEMBER_DB_ROW]);
    await p;

    expect(useMemberStore.getState().members).toHaveLength(1);
    expect(useMemberStore.getState().members[0].id).toBe("m1");
  });

  it("clear() empties members and resets undo/redo history", () => {
    useMemberStore.setState({
      members: [{ id: "m1" } as never],
      undoStack: [{ undo: async () => {}, redo: async () => {} }],
      redoStack: [{ undo: async () => {}, redo: async () => {} }],
    });

    useMemberStore.getState().clear();

    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(useMemberStore.getState().undoStack).toHaveLength(0);
    expect(useMemberStore.getState().redoStack).toHaveLength(0);
  });
});

describe("useMemberStore — fetchMemberDetail caching", () => {
  beforeEach(() => {
    useMemberStore.setState({
      members: [],
      detailLoadedIds: new Set<string>(),
      undoStack: [],
      redoStack: [],
    });
  });

  it("issues a network call on the first fetchMemberDetail and caches the id", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.getMember).mockResolvedValue(MEMBER_DB_ROW);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);

    await useMemberStore.getState().fetchMemberDetail("m1");

    expect(WorkspaceService.getMember).toHaveBeenCalledWith(TREE_ID, "m1");
    expect(useMemberStore.getState().detailLoadedIds.has("m1")).toBe(true);
  });

  it("skips the network call on the second fetchMemberDetail for the same id", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.getMember).mockResolvedValue(MEMBER_DB_ROW);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);

    // First call — fetches from network
    await useMemberStore.getState().fetchMemberDetail("m1");
    expect(WorkspaceService.getMember).toHaveBeenCalledTimes(1);

    // Second call — served from cache, no extra GET
    await useMemberStore.getState().fetchMemberDetail("m1");
    expect(WorkspaceService.getMember).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses the cache and re-fetches", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.getMember).mockResolvedValue(MEMBER_DB_ROW);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);

    // Seed the cache
    await useMemberStore.getState().fetchMemberDetail("m1");
    expect(WorkspaceService.getMember).toHaveBeenCalledTimes(1);

    // Force re-fetch despite cache hit
    await useMemberStore.getState().fetchMemberDetail("m1", true);
    expect(WorkspaceService.getMember).toHaveBeenCalledTimes(2);
  });

  it("refreshMembers resets detailLoadedIds, re-arming future fetchMemberDetail calls", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(WorkspaceService.getMember).mockResolvedValue(MEMBER_DB_ROW);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);

    // Populate the cache
    await useMemberStore.getState().fetchMemberDetail("m1");
    expect(useMemberStore.getState().detailLoadedIds.has("m1")).toBe(true);

    // refreshMembers resets the cache
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();
    expect(useMemberStore.getState().detailLoadedIds.has("m1")).toBe(false);

    // Next fetchMemberDetail should hit the network again
    await useMemberStore.getState().fetchMemberDetail("m1");
    expect(WorkspaceService.getMember).toHaveBeenCalledTimes(2);
  });

  it("clear() resets detailLoadedIds", () => {
    useMemberStore.setState({
      members: [{ id: "m1" } as never],
      detailLoadedIds: new Set(["m1"]),
      undoStack: [],
      redoStack: [],
    });

    useMemberStore.getState().clear();

    expect(useMemberStore.getState().detailLoadedIds.size).toBe(0);
  });
});

describe("saved view graph configuration", () => {
  const view = {
    id: "view",
    workspace_id: TREE_ID,
    owner_id: "owner",
    name: "Scoped view",
    focus_member_id: "m1",
    section_ids: ["section"],
    ancestor_depth: 0,
    descendant_depth: 0,
    include_partners: false,
    filters: {},
    config_version: 1,
    version: 1,
    created_at: "2026",
    updated_at: "2026",
    last_opened: null,
    positions: [{ node_id: "m1", position_x: 123, position_y: 456 }],
  };

  it("applies sections, zero depths, partner exclusion and layout together", async () => {
    selectTree();
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValue({
      root_id: "m1",
      members: [MEMBER_DB_ROW],
      relations: [],
      truncated: false,
      total_member_count: 1,
    });
    await useMemberStore.getState().applySavedView(view);
    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      "m1",
      0,
      0,
      false,
      ["section"],
    );
    expect(useMemberStore.getState().members[0].position).toEqual({
      x: 123,
      y: 456,
    });
    expect(useMemberStore.getState().activeSavedViewId).toBe("view");
    await useMemberStore
      .getState()
      .persistPositions([{ id: "m1", x: 400, y: 500 }]);
    expect(WorkspaceService.updateSavedViewPositions).toHaveBeenCalledWith(
      TREE_ID,
      "view",
      [{ node_id: "m1", position_x: 400, position_y: 500 }],
    );
    expect(WorkspaceService.updateMemberPositions).not.toHaveBeenCalled();
  });

  it("opens section-only views and resets configuration on Explore", async () => {
    selectTree();
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValue({
      root_id: "m1",
      members: [MEMBER_DB_ROW],
      relations: [],
      truncated: false,
      total_member_count: 1,
    });
    await useMemberStore
      .getState()
      .applySavedView({ ...view, focus_member_id: null });
    expect(WorkspaceService.getNeighborhood).toHaveBeenCalledWith(
      TREE_ID,
      undefined,
      0,
      0,
      false,
      ["section"],
    );
    mockServiceWithMember();
    await useMemberStore.getState().exitFocus();
    expect(useMemberStore.getState()).toMatchObject({
      activeSavedViewId: null,
      savedViewPositions: [],
      focusSectionIds: null,
      neighborhoodUp: 3,
      neighborhoodDown: 3,
      neighborhoodPartners: true,
    });
  });

  it("applies saved member filters before rendering", async () => {
    selectTree();
    vi.mocked(WorkspaceService.getNeighborhood).mockResolvedValue({
      root_id: "m1",
      members: [MEMBER_DB_ROW],
      relations: [],
      truncated: false,
      total_member_count: 1,
    });
    await useMemberStore
      .getState()
      .applySavedView({ ...view, filters: { gender: "f" } });
    expect(useMemberStore.getState().members).toEqual([]);
  });
});

it("undoing a saved-view arrangement after leaving it does not move Explore nodes", async () => {
  selectTree();
  mockServiceWithMember();
  await useMemberStore.getState().refreshMembers();
  useMemberStore.setState({ activeSavedViewId: "view" });
  await useMemberStore
    .getState()
    .persistPositions([{ id: "m1", x: 100, y: 200 }]);
  await useMemberStore.getState().exitFocus();
  const canonical = useMemberStore.getState().members[0].position;
  await useMemberStore.getState().undo();
  expect(useMemberStore.getState().members[0].position).toEqual(canonical);
  expect(WorkspaceService.updateMemberPositions).not.toHaveBeenCalled();
});

describe("useMemberStore — runHistoryGroup", () => {
  const entry = (log: string[], name: string) => ({
    undo: async () => {
      log.push(`undo ${name}`);
    },
    redo: async () => {
      log.push(`redo ${name}`);
    },
  });

  it("folds the steps recorded inside it into one undo step", async () => {
    const log: string[] = [];
    const earlier = entry(log, "earlier");
    useMemberStore.getState()._pushHistory(earlier);

    const grouped = await useMemberStore
      .getState()
      .runHistoryGroup(async () => {
        useMemberStore.getState()._pushHistory(entry(log, "a"));
        useMemberStore.getState()._pushHistory(entry(log, "b"));
      });

    const { undoStack } = useMemberStore.getState();
    expect(undoStack).toEqual([earlier, grouped]);

    await useMemberStore.getState().undo();
    expect(log).toEqual(["undo b", "undo a"]);

    await useMemberStore.getState().redo();
    expect(log).toEqual(["undo b", "undo a", "redo a", "redo b"]);
  });

  it("returns null when nothing was recorded", async () => {
    const grouped = await useMemberStore
      .getState()
      .runHistoryGroup(async () => {});
    expect(grouped).toBeNull();
  });

  it("undoEntry only undoes the entry while it is still the latest step", async () => {
    const log: string[] = [];
    const first = entry(log, "first");
    useMemberStore.getState()._pushHistory(first);
    useMemberStore.getState()._pushHistory(entry(log, "second"));

    await useMemberStore.getState().undoEntry(first);
    expect(log).toEqual([]);

    await useMemberStore.getState().undo();
    await useMemberStore.getState().undoEntry(first);
    expect(log).toEqual(["undo second", "undo first"]);
  });
});
