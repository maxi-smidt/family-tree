import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "./useMemberStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { MemberDB } from "@/types/member";
import { Tree } from "@/types/tree";
import { toast } from "sonner";

vi.mock("@/services/TreeService");
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
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
  additionalData: null,
  isCollapsed: 0,
  positionX: 0,
  positionY: 0,
};

function makeTree(role: "owner" | "editor" | "viewer" = "owner"): Tree {
  return { id: TREE_ID, name: "Test Tree", role };
}

function selectTree(role: "owner" | "editor" | "viewer" = "owner") {
  useTreeStore.setState({ selectedTree: makeTree(role) });
}

function mockServiceEmpty() {
  vi.mocked(TreeService.getMembers).mockResolvedValue([]);
  vi.mocked(TreeService.getRelations).mockResolvedValue([]);
  vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
}

function mockServiceWithMember() {
  vi.mocked(TreeService.getMembers).mockResolvedValue([MEMBER_DB_ROW]);
  vi.mocked(TreeService.getRelations).mockResolvedValue([]);
  vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  useMemberStore.setState({ members: [], undoStack: [], redoStack: [] });
  useTreeStore.setState({ selectedTree: undefined });
  // syncVitalEvent calls the event store which uses these service methods
  vi.mocked(TreeService.getEvents).mockResolvedValue([]);
  vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);
  vi.mocked(TreeService.addEvent).mockResolvedValue(undefined);
});

describe("useMemberStore — refreshMembers", () => {
  it("clears members when no tree is selected", async () => {
    useMemberStore.setState({ members: [{ id: "stale" } as never] });

    await useMemberStore.getState().refreshMembers();

    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(TreeService.getMembers).not.toHaveBeenCalled();
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
    expect(TreeService.getMembers).toHaveBeenCalledWith(TREE_ID);
  });

  it("calls getMembers, getRelations, and getDiseases in parallel", async () => {
    selectTree();
    mockServiceEmpty();

    await useMemberStore.getState().refreshMembers();

    expect(TreeService.getMembers).toHaveBeenCalledWith(TREE_ID);
    expect(TreeService.getRelations).toHaveBeenCalledWith(TREE_ID);
    expect(TreeService.getDiseases).toHaveBeenCalledWith(TREE_ID);
  });
});

describe("useMemberStore — addMember", () => {
  it("calls TreeService.addMember then refreshes", async () => {
    selectTree();
    vi.mocked(TreeService.addMember).mockResolvedValue(undefined);
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
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(newMember);

    expect(TreeService.addMember).toHaveBeenCalledWith(
      TREE_ID,
      expect.objectContaining({ id: "m2" }),
    );
    expect(TreeService.getMembers).toHaveBeenCalled();
  });

  it("adds a history entry after addMember", async () => {
    selectTree();
    vi.mocked(TreeService.addMember).mockResolvedValue(undefined);
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
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(member);

    expect(useMemberStore.getState().undoStack).toHaveLength(1);
    expect(useMemberStore.getState().redoStack).toHaveLength(0);
  });
});

describe("useMemberStore — removeMember", () => {
  it("calls TreeService.removeMember then refreshes", async () => {
    selectTree();
    mockServiceWithMember();
    // Pre-populate the store so removeMember finds the member
    await useMemberStore.getState().refreshMembers();

    vi.mocked(TreeService.removeMember).mockResolvedValue(undefined);
    mockServiceEmpty(); // after deletion, list is empty

    await useMemberStore.getState().removeMember("m1");

    expect(TreeService.removeMember).toHaveBeenCalledWith(TREE_ID, "m1");
    expect(useMemberStore.getState().members).toHaveLength(0);
  });

  it("does nothing when member is not found", async () => {
    selectTree();
    mockServiceEmpty();
    await useMemberStore.getState().refreshMembers();

    await useMemberStore.getState().removeMember("nonexistent");

    expect(TreeService.removeMember).not.toHaveBeenCalled();
  });
});

describe("useMemberStore — updateMemberPartial", () => {
  it("calls TreeService.updateMember with the changes then refreshes", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(TreeService.updateMember).mockResolvedValue(undefined);
    mockServiceWithMember(); // refresh returns same member

    await useMemberStore
      .getState()
      .updateMemberPartial("m1", { firstName: "Johnny" });

    expect(TreeService.updateMember).toHaveBeenCalledWith(
      TREE_ID,
      "m1",
      expect.objectContaining({ firstName: "Johnny" }),
    );
    expect(TreeService.getMembers).toHaveBeenCalledTimes(2); // initial + after update
  });

  it("adds a history entry after updateMemberPartial", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(TreeService.updateMember).mockResolvedValue(undefined);
    mockServiceWithMember();

    await useMemberStore
      .getState()
      .updateMemberPartial("m1", { lastName: "Smith" });

    expect(useMemberStore.getState().undoStack).toHaveLength(1);
  });
});

describe("useMemberStore — optimistic mutation rollback", () => {
  it("rolls back collapsed state and reports an error when persistence fails", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(TreeService.updateMemberCollapsedBulk).mockRejectedValueOnce(
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
    expect(TreeService.getMembers).toHaveBeenCalledTimes(2);
  });

  it("rolls back member positions and skips history when persistence fails", async () => {
    selectTree();
    mockServiceWithMember();
    await useMemberStore.getState().refreshMembers();

    vi.mocked(TreeService.updateMemberPositions).mockRejectedValueOnce(
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
    expect(TreeService.getMembers).toHaveBeenCalledTimes(2);
  });
});

describe("useMemberStore — undo/redo", () => {
  it("undo triggers the stored undo action", async () => {
    selectTree();
    vi.mocked(TreeService.addMember).mockResolvedValue(undefined);
    vi.mocked(TreeService.removeMember).mockResolvedValue(undefined);
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
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(member);
    expect(useMemberStore.getState().undoStack).toHaveLength(1);

    await useMemberStore.getState().undo();

    // undo of addMember calls removeMember
    expect(TreeService.removeMember).toHaveBeenCalledWith(TREE_ID, "m4");
    expect(useMemberStore.getState().undoStack).toHaveLength(0);
    expect(useMemberStore.getState().redoStack).toHaveLength(1);
  });

  it("redo re-applies the action after undo", async () => {
    selectTree();
    vi.mocked(TreeService.addMember).mockResolvedValue(undefined);
    vi.mocked(TreeService.removeMember).mockResolvedValue(undefined);
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
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: { x: 0, y: 0 },
      relations: [],
      diseases: [],
      birthplace: null,
      hometown: null,
      placesLived: [],
    };

    await useMemberStore.getState().addMember(member);
    await useMemberStore.getState().undo();
    await useMemberStore.getState().redo();

    // redo of addMember calls addMember again
    expect(TreeService.addMember).toHaveBeenCalledTimes(2);
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
    vi.mocked(TreeService.getMembers).mockReturnValue(pending);
    vi.mocked(TreeService.getRelations).mockResolvedValue([]);
    vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
    useTreeStore.setState({ selectedTree: makeTree() });

    const p = useMemberStore.getState().refreshMembers(TREE_ID);
    // user switches away before the fetch resolves
    useTreeStore.setState({
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
    vi.mocked(TreeService.getMembers).mockReturnValue(pending);
    vi.mocked(TreeService.getRelations).mockResolvedValue([]);
    vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
    useTreeStore.setState({ selectedTree: makeTree() });

    const p = useMemberStore.getState().refreshMembers(TREE_ID);
    // user disconnects before the fetch resolves
    useTreeStore.setState({ selectedTree: undefined });
    resolve([MEMBER_DB_ROW]);
    await p;

    expect(useMemberStore.getState().members).toHaveLength(0); // stale data dropped
  });

  it("writes data when the explicit treeId is still active", async () => {
    let resolve!: (v: MemberDB[]) => void;
    const pending = new Promise<MemberDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(TreeService.getMembers).mockReturnValue(pending);
    vi.mocked(TreeService.getRelations).mockResolvedValue([]);
    vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
    useTreeStore.setState({ selectedTree: makeTree() });

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
