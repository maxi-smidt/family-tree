import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Edge, EdgeChange } from "@xyflow/react";
import { useFlowInteractions } from "./useFlowInteractions";
import { Member } from "@/types/member";
import type { WorkerUnionInfo } from "@/workers/treeProcessor.types";

const removeRelationBidirectional = vi.fn();
const updateMemberPartial = vi.fn();
const persistPositions = vi.fn();

vi.mock("@/hooks/useMemberStore", () => ({
  useMemberStore: () => ({
    removeRelationBidirectional,
    updateMemberPartial,
    persistPositions,
  }),
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
    date: { birth: "", death: null },
    parents: { paternalParent: null, maternalParent: null },
    additionalData: null,
    birthplace: null,
    hometown: null,
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
    useFlowInteractions(
      members,
      edges,
      unions,
      noop,
      noop,
      noop,
      noop,
      noop,
    ),
  );
}

function remove(id: string): EdgeChange {
  return { type: "remove", id };
}

describe("useFlowInteractions – removeMemberEdge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a non-couple relation drawn as a rel: edge", () => {
    const a = makeMember("aaaa-1111", {
      relations: [
        { fromMemberId: "aaaa-1111", toMemberId: "bbbb-2222", relationType: "sibling" },
      ],
    });
    const b = makeMember("bbbb-2222");
    const edgeId = `rel:${["aaaa-1111", "bbbb-2222"].sort().join("-")}:sibling`;
    const edges: Edge[] = [
      { id: edgeId, source: "aaaa-1111", target: "bbbb-2222" },
    ];

    const { result } = setup([a, b], edges, []);
    act(() => result.current.onEdgesChange([remove(edgeId)]));

    expect(removeRelationBidirectional).toHaveBeenCalledWith(
      "aaaa-1111",
      "bbbb-2222",
      "sibling",
    );
    expect(removeRelationBidirectional).toHaveBeenCalledTimes(1);
  });

  it("removes the couple relation behind a union edge", () => {
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
    act(() => result.current.onEdgesChange([remove("ue:union-p1-p2:left")]));

    expect(removeRelationBidirectional).toHaveBeenCalledWith("p1", "p2", "married");
    expect(removeRelationBidirectional).toHaveBeenCalledTimes(1);
  });

  it("detaches a shared child when its union edge is removed", () => {
    const { result } = setup([], [], [
      {
        id: "union-p1-p2",
        partner1Id: "p1",
        partner2Id: "p2",
        childIds: ["c1"],
        relationType: "married",
      },
    ]);

    act(() =>
      result.current.onEdgesChange([remove("ue:union-p1-p2:child:c1")]),
    );

    expect(updateMemberPartial).toHaveBeenCalledWith("c1", {
      paternalParentId: null,
      maternalParentId: null,
    });
  });

  it("clears the matching parent slot for a single-parent edge", () => {
    const child = makeMember("child-1", {
      parents: { paternalParent: "dad-1", maternalParent: null },
    });
    const edges: Edge[] = [
      { id: "e:dad-1:child-1", source: "dad-1", target: "child-1" },
    ];

    const { result } = setup([child], edges, []);
    act(() => result.current.onEdgesChange([remove("e:dad-1:child-1")]));

    expect(updateMemberPartial).toHaveBeenCalledWith("child-1", {
      paternalParentId: null,
    });
  });
});
