import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "@/hooks/useMemberStore";
import { SectionSuggestionDB } from "@/types/section";
import { Member } from "@/types/member";
import { NewMemberSectionSuggestionsDialog } from "./NewMemberSectionSuggestionsDialog";

function makeSuggestion(
  overrides: Partial<SectionSuggestionDB> = {},
): SectionSuggestionDB {
  return {
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
    ...overrides,
  };
}

describe("NewMemberSectionSuggestionsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMemberStore.setState({
      members: [
        { id: "parent-1", firstName: "Otto", lastName: "Adams" } as Member,
      ],
    });
  });

  it("renders nothing open when there are no suggestions", () => {
    render(
      <NewMemberSectionSuggestionsDialog
        memberName="Lea Adams"
        suggestions={null}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows each suggested section with who it matched via", () => {
    render(
      <NewMemberSectionSuggestionsDialog
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText("Vienna branch")).toBeInTheDocument();
    expect(screen.getByText("via Otto Adams")).toBeInTheDocument();
  });

  it("confirms only the toggled sections, none by default", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <NewMemberSectionSuggestionsDialog
        memberName="Lea Adams"
        suggestions={[
          makeSuggestion(),
          makeSuggestion({
            section: {
              id: "s2",
              workspace_id: "tree-1",
              name: "Other branch",
              position: 1,
              created_at: "2024-01-01T00:00:00Z",
              member_count: 2,
              can_write: true,
            },
          }),
        ]}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Vienna branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to selected" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(["s1"]));
  });

  it("skip calls onSkip without confirming anything", () => {
    const onSkip = vi.fn();
    const onConfirm = vi.fn();
    render(
      <NewMemberSectionSuggestionsDialog
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onConfirm={onConfirm}
        onSkip={onSkip}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave unassigned" }));

    expect(onSkip).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
