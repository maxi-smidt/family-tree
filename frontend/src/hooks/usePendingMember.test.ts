import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePendingMember } from "./usePendingMember";
import { useMemberStore } from "./useMemberStore";
import { useSectionStore } from "./useSectionStore";
import { createMember, Member } from "@/types/member";
import { SectionSuggestionDB } from "@/types/section";

const PARENT: Member = {
  ...createMember({ x: 0, y: 0 }),
  id: "parent-1",
  firstName: "Otto",
  lastName: "Adams",
};

const SUGGESTION: SectionSuggestionDB = {
  section: {
    id: "s1",
    workspace_id: "tree-1",
    name: "Vienna branch",
    position: 0,
    created_at: "2024-01-01T00:00:00Z",
    member_count: 4,
    can_write: true,
  },
  matched_via_member_ids: ["parent-1"],
};

describe("usePendingMember — new-member section suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMemberStore.setState({
      members: [PARENT],
      addMember: vi.fn().mockResolvedValue(undefined),
      addRelation: vi.fn().mockResolvedValue(undefined),
    });
    useSectionStore.setState({
      getSectionSuggestions: vi.fn().mockResolvedValue([]),
      addMemberToSections: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("surfaces suggestions after a relation-creating save", async () => {
    vi.mocked(
      useSectionStore.getState().getSectionSuggestions,
    ).mockResolvedValue([SUGGESTION]);
    const { result } = renderHook(() =>
      usePendingMember({ onHorizontalRelationReady: vi.fn() }),
    );

    act(() => result.current.onAddChild("parent-1"));
    await act(async () => {
      await result.current.saveNewMember({
        firstName: "Lea",
        lastName: "Adams",
      });
    });

    expect(useSectionStore.getState().getSectionSuggestions).toHaveBeenCalled();
    expect(result.current.sectionSuggestions).toEqual({
      memberId: expect.any(String),
      memberName: "Lea Adams",
      suggestions: [SUGGESTION],
    });
  });

  it("does not check suggestions when the save has no relation", async () => {
    const { result } = renderHook(() =>
      usePendingMember({ onHorizontalRelationReady: vi.fn() }),
    );

    act(() => result.current.createNew(createMember({ x: 0, y: 0 })));
    await act(async () => {
      await result.current.saveNewMember({
        firstName: "Lea",
        lastName: "Adams",
      });
    });

    expect(
      useSectionStore.getState().getSectionSuggestions,
    ).not.toHaveBeenCalled();
    expect(result.current.sectionSuggestions).toBeNull();
  });

  it("confirming with selected sections adds the member to them", async () => {
    vi.mocked(
      useSectionStore.getState().getSectionSuggestions,
    ).mockResolvedValue([SUGGESTION]);
    const { result } = renderHook(() =>
      usePendingMember({ onHorizontalRelationReady: vi.fn() }),
    );

    act(() => result.current.onAddChild("parent-1"));
    await act(async () => {
      await result.current.saveNewMember({
        firstName: "Lea",
        lastName: "Adams",
      });
    });
    const memberId = result.current.sectionSuggestions?.memberId as string;

    await act(async () => {
      await result.current.confirmSectionSuggestions(["s1"]);
    });

    expect(useSectionStore.getState().addMemberToSections).toHaveBeenCalledWith(
      memberId,
      ["s1"],
    );
    expect(result.current.sectionSuggestions).toBeNull();
  });

  it("skipping clears the suggestion without adding anything", async () => {
    vi.mocked(
      useSectionStore.getState().getSectionSuggestions,
    ).mockResolvedValue([SUGGESTION]);
    const { result } = renderHook(() =>
      usePendingMember({ onHorizontalRelationReady: vi.fn() }),
    );

    act(() => result.current.onAddChild("parent-1"));
    await act(async () => {
      await result.current.saveNewMember({
        firstName: "Lea",
        lastName: "Adams",
      });
    });

    act(() => result.current.dismissSectionSuggestions());

    expect(result.current.sectionSuggestions).toBeNull();
    expect(
      useSectionStore.getState().addMemberToSections,
    ).not.toHaveBeenCalled();
  });
});
