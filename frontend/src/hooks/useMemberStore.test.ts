import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "./useMemberStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { MemberDB } from "@/types/member";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");

const TREE_ID = "tree-abc";

const MEMBER_DB_ROW: MemberDB = {
  id: "m1",
  gender: "m",
  firstName: "John",
  lastName: "Doe",
  maidenName: null,
  imageData: null,
  dateOfBirth: "1980-01-01",
  dateOfDeath: null,
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
      firstName: "Jane",
      lastName: "Doe",
      maidenName: null,
      imageData: null,
      date: { birth: "1990-01-01", death: null },
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
      firstName: "Bob",
      lastName: "Smith",
      maidenName: null,
      imageData: null,
      date: { birth: "1970-06-15", death: null },
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

describe("useMemberStore — undo/redo", () => {
  it("undo triggers the stored undo action", async () => {
    selectTree();
    vi.mocked(TreeService.addMember).mockResolvedValue(undefined);
    vi.mocked(TreeService.removeMember).mockResolvedValue(undefined);
    mockServiceEmpty();

    const member = {
      id: "m4",
      gender: "m" as const,
      firstName: "Undo",
      lastName: "Test",
      maidenName: null,
      imageData: null,
      date: { birth: "2000-01-01", death: null },
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
      firstName: "Redo",
      lastName: "Test",
      maidenName: null,
      imageData: null,
      date: { birth: "1995-05-20", death: null },
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
