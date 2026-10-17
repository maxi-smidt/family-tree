import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Edge, EdgeChange, Connection } from "@xyflow/react";
import { useFlowInteractions } from "./useFlowInteractions";
import { Member } from "@/types/member";
import type { WorkerUnionInfo } from "@/workers/treeProcessor.types";

const removeRelationBidirectional = vi.fn();
const updateMemberPartial = vi.fn();
const persistPositions = vi.fn();
const historyEntry = { undo: vi.fn(), redo: vi.fn() };
const runHistoryGroup = vi.fn(async (fn: () => Promise<void>) => {
  await fn();
  return historyEntry;
});
const undoEntry = vi.fn();
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useMemberStore", () => ({
  useMemberStore: () => ({
    removeRelationBidirectional,
    updateMemberPartial,
    persistPositions,
    runHistoryGroup,
    undoEntry,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function makeMember(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    gender: "o",
    academicTitle: null,
    firstName: id,
    middleNames: null,
    baptismalName: null,
    lastName: "Test",
    maidenName: null,
    imageData: null,
    deceased: false,
    adopted: false,
    date: { birth: "", death: null },
    parents: { paternalParent: null, maternalParent: null },
    additionalData: null,
    birthplace: null,
    hometown: null,
    cemetery: null,
    placesLived: [],
    isCollapsed: false,
    position: { x: 0, y: 0 },
    relations: [],
    ...overrides,
  };
}

const noop = vi.fn();

function setup(members: Member[], edges: Edge[], unions: WorkerUnionInfo[]) {
  return renderHook(() =>
    useFlowInteractions(members, edges, unions, noop, noop, noop, noop, noop),
  );
}

function remove(id: string): EdgeChange {
  return { type: "remove", id };
}

describe("useFlowInteractions – removeMemberEdge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a non-couple relation drawn as a rel: edge", async () => {
    const a = makeMember("aaaa-1111", {
      relations: [
        {
          fromMemberId: "aaaa-1111",
          toMemberId: "bbbb-2222",
          relationType: "sibling",
        },
      ],
    });
    const b = makeMember("bbbb-2222");
    const edgeId = `rel:${["aaaa-1111", "bbbb-2222"].sort().join("-")}:sibling`;
    const edges: Edge[] = [
      { id: edgeId, source: "aaaa-1111", target: "bbbb-2222" },
    ];

    const { result } = setup([a, b], edges, []);
    await act(async () => result.current.onEdgesChange([remove(edgeId)]));

    expect(removeRelationBidirectional).toHaveBeenCalledWith(
      "aaaa-1111",
      "bbbb-2222",
      "sibling",
    );
    expect(removeRelationBidirectional).toHaveBeenCalledTimes(1);
  });

  it("removes the couple relation behind a union edge", async () => {
    const union: WorkerUnionInfo = {
      id: "union-p1-p2",
      partner1Id: "p1",
      partner2Id: "p2",
      childIds: ["c1"],
      relationType: "married",
    };
    const edges: Edge[] = [
      { id: "ue:union-p1-p2:left", source: "p1", target: "union-p1-p2" },
    ];

    const { result } = setup([], edges, [union]);
    await act(async () =>
      result.current.onEdgesChange([remove("ue:union-p1-p2:left")]),
    );

    expect(removeRelationBidirectional).toHaveBeenCalledWith(
      "p1",
      "p2",
      "married",
    );
    expect(removeRelationBidirectional).toHaveBeenCalledTimes(1);
  });

  it("detaches a shared child when its union edge is removed", async () => {
    const { result } = setup(
      [],
      [],
      [
        {
          id: "union-p1-p2",
          partner1Id: "p1",
          partner2Id: "p2",
          childIds: ["c1"],
          relationType: "married",
        },
      ],
    );

    await act(async () =>
      result.current.onEdgesChange([remove("ue:union-p1-p2:child:c1")]),
    );

    expect(updateMemberPartial).toHaveBeenCalledWith("c1", {
      paternalParentId: null,
      maternalParentId: null,
    });
  });

  it("clears the matching parent slot for a single-parent edge", async () => {
    const child = makeMember("child-1", {
      parents: { paternalParent: "dad-1", maternalParent: null },
    });
    const edges: Edge[] = [
      { id: "e:dad-1:child-1", source: "dad-1", target: "child-1" },
    ];

    const { result } = setup([child], edges, []);
    await act(async () =>
      result.current.onEdgesChange([remove("e:dad-1:child-1")]),
    );

    expect(updateMemberPartial).toHaveBeenCalledWith("child-1", {
      paternalParentId: null,
    });
  });
  // Father (left) and mother (right) share a child through the union dot.
  function familyWithUnion(relationType?: string) {
    const dad = makeMember("dad", { gender: "m" });
    const mom = makeMember("mom", { gender: "f" });
    const kid = makeMember("kid", {
      parents: { paternalParent: "dad", maternalParent: "mom" },
    });
    const union: WorkerUnionInfo = {
      id: "union-dad-mom",
      partner1Id: "dad",
      partner2Id: "mom",
      childIds: ["kid"],
      relationType,
    };
    const edges: Edge[] = [
      { id: "ue:union-dad-mom:left", source: "dad", target: "union-dad-mom" },
      { id: "ue:union-dad-mom:right", source: "union-dad-mom", target: "mom" },
      {
        id: "ue:union-dad-mom:child:kid",
        source: "union-dad-mom",
        target: "kid",
      },
    ];
    return { members: [dad, mom, kid], edges, union };
  }

  it("removing the father's union line keeps the mother linked to the child", async () => {
    const { members, edges, union } = familyWithUnion("married");
    const { result } = setup(members, edges, [union]);

    await act(async () =>
      result.current.onEdgesChange([remove("ue:union-dad-mom:left")]),
    );

    expect(removeRelationBidirectional).toHaveBeenCalledWith(
      "dad",
      "mom",
      "married",
    );
    expect(updateMemberPartial).toHaveBeenCalledWith("kid", {
      paternalParentId: null,
    });
    expect(updateMemberPartial).toHaveBeenCalledTimes(1);
  });

  it("removing the mother's union line keeps the father linked to the child", async () => {
    const { members, edges, union } = familyWithUnion("married");
    const { result } = setup(members, edges, [union]);

    await act(async () =>
      result.current.onEdgesChange([remove("ue:union-dad-mom:right")]),
    );

    expect(updateMemberPartial).toHaveBeenCalledWith("kid", {
      maternalParentId: null,
    });
    expect(updateMemberPartial).toHaveBeenCalledTimes(1);
  });

  it("detaches a partner from a union that only exists through shared children", async () => {
    const { members, edges, union } = familyWithUnion(undefined);
    const { result } = setup(members, edges, [union]);

    await act(async () =>
      result.current.onEdgesChange([remove("ue:union-dad-mom:left")]),
    );

    expect(removeRelationBidirectional).not.toHaveBeenCalled();
    expect(updateMemberPartial).toHaveBeenCalledWith("kid", {
      paternalParentId: null,
    });
  });

  it("records one undo step and offers Undo in a toast", async () => {
    const { members, edges, union } = familyWithUnion("married");
    const { result } = setup(members, edges, [union]);

    await act(async () =>
      result.current.onEdgesChange([remove("ue:union-dad-mom:left")]),
    );

    expect(runHistoryGroup).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const options = toastSuccess.mock.calls[0][1];
    options.action.onClick();
    expect(undoEntry).toHaveBeenCalledWith(historyEntry);
  });

  it("shows an error toast when removal fails", async () => {
    removeRelationBidirectional.mockRejectedValueOnce(new Error("boom"));
    const { members, edges, union } = familyWithUnion("married");
    const { result } = setup(members, edges, [union]);

    await act(async () =>
      result.current.onEdgesChange([remove("ue:union-dad-mom:left")]),
    );

    expect(toastError).toHaveBeenCalledWith("toast-error-edge-remove");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("useFlowInteractions – onBeforeDelete", () => {
  it("allows deleting selected connections on their own", async () => {
    const { result } = setup([], [], []);
    const edges: Edge[] = [
      { id: "e:a:b", source: "a", target: "b", selected: true },
    ];
    await expect(
      result.current.onBeforeDelete({ nodes: [], edges }),
    ).resolves.toBe(true);
  });

  it("keeps a member's attached connections out of a member deletion", async () => {
    const { result } = setup([], [], []);
    const nodes = [{ id: "a", position: { x: 0, y: 0 }, data: {} }];
    const edges: Edge[] = [
      { id: "e:a:b", source: "a", target: "b" },
      { id: "e:c:d", source: "c", target: "d", selected: true },
    ];
    await expect(
      result.current.onBeforeDelete({ nodes, edges }),
    ).resolves.toEqual({ nodes, edges: [edges[1]] });
  });
});

describe("useFlowInteractions – union child connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function connection(source: string, target: string): Connection {
    return { source, target, sourceHandle: "bottom", targetHandle: "top" };
  }

  it("assigns paternal/maternal slots by gender when dragging union to a childless member", () => {
    const p1 = makeMember("p1", { gender: "m" });
    const p2 = makeMember("p2", { gender: "f" });
    const child = makeMember("child-1");
    const union: WorkerUnionInfo = {
      id: "union-p1-p2",
      partner1Id: "p1",
      partner2Id: "p2",
      childIds: [],
      relationType: "married",
    };

    const { result } = setup([p1, p2, child], [], [union]);
    act(() => result.current.onConnect(connection("union-p1-p2", "child-1")));

    expect(updateMemberPartial).toHaveBeenCalledWith("child-1", {
      paternalParentId: "p1",
      maternalParentId: "p2",
    });
    expect(updateMemberPartial).toHaveBeenCalledTimes(1);
  });

  it("falls back to partner1→paternal, partner2→maternal when genders don't disambiguate", () => {
    const p1 = makeMember("p1", { gender: "o" });
    const p2 = makeMember("p2", { gender: "o" });
    const child = makeMember("child-1");
    const union: WorkerUnionInfo = {
      id: "union-p1-p2",
      partner1Id: "p1",
      partner2Id: "p2",
      childIds: [],
      relationType: "married",
    };

    const { result } = setup([p1, p2, child], [], [union]);
    act(() => result.current.onConnect(connection("union-p1-p2", "child-1")));

    expect(updateMemberPartial).toHaveBeenCalledWith("child-1", {
      paternalParentId: "p1",
      maternalParentId: "p2",
    });
    expect(updateMemberPartial).toHaveBeenCalledTimes(1);
  });

  it("rejects when the target already has a parent", () => {
    const p1 = makeMember("p1", { gender: "m" });
    const p2 = makeMember("p2", { gender: "f" });
    const child = makeMember("child-1", {
      parents: { paternalParent: "existing-dad", maternalParent: null },
    });
    const union: WorkerUnionInfo = {
      id: "union-p1-p2",
      partner1Id: "p1",
      partner2Id: "p2",
      childIds: [],
      relationType: "married",
    };

    const { result } = setup([p1, p2, child], [], [union]);
    act(() => result.current.onConnect(connection("union-p1-p2", "child-1")));

    expect(updateMemberPartial).not.toHaveBeenCalled();
  });

  it("rejects when the target is one of the union's partners", () => {
    const p1 = makeMember("p1", { gender: "m" });
    const p2 = makeMember("p2", { gender: "f" });
    const union: WorkerUnionInfo = {
      id: "union-p1-p2",
      partner1Id: "p1",
      partner2Id: "p2",
      childIds: [],
      relationType: "married",
    };

    const { result } = setup([p1, p2], [], [union]);
    act(() => result.current.onConnect(connection("union-p1-p2", "p1")));

    expect(updateMemberPartial).not.toHaveBeenCalled();
  });

  it("rejects a connection that would create a cycle", () => {
    const p1 = makeMember("p1", {
      gender: "m",
      parents: { paternalParent: "child-1", maternalParent: null },
    });
    const p2 = makeMember("p2", { gender: "f" });
    const child = makeMember("child-1");
    const union: WorkerUnionInfo = {
      id: "union-p1-p2",
      partner1Id: "p1",
      partner2Id: "p2",
      childIds: [],
      relationType: "married",
    };

    const { result } = setup([p1, p2, child], [], [union]);
    act(() => result.current.onConnect(connection("union-p1-p2", "child-1")));

    expect(updateMemberPartial).not.toHaveBeenCalled();
  });
});
