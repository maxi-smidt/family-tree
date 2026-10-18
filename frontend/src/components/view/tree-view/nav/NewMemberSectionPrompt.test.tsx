import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "@/hooks/useMemberStore";
import { SectionSuggestionDB } from "@/types/section";
import { Member } from "@/types/member";
import {
  NewMemberSectionPrompt,
  SECTION_PROMPT_DURATION_MS,
} from "./NewMemberSectionPrompt";

function makeSuggestion(
  id = "s1",
  name = "Vienna branch",
  canWrite = true,
): SectionSuggestionDB {
  return {
    section: {
      id,
      workspace_id: "tree-1",
      name,
      position: 0,
      created_at: "2024-01-01T00:00:00Z",
      member_count: 4,
      can_write: canWrite,
    },
    matched_via_member_ids: ["parent-1"],
  };
}

describe("NewMemberSectionPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMemberStore.setState({
      members: [
        { id: "parent-1", firstName: "Otto", lastName: "Adams" } as Member,
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there are no suggestions", () => {
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={null}
        onAdd={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("shows each suggested section with who it matched via", () => {
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onAdd={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Vienna branch")).toBeInTheDocument();
    expect(screen.getByText("via Otto Adams")).toBeInTheDocument();
  });

  it("adds the member to one section at a time", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion(), makeSuggestion("s2", "Other branch")]}
        onAdd={onAdd}
        onDismiss={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add to Vienna branch" }),
      );
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("s1");
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to Other branch" }),
    ).toBeEnabled();
  });

  it("disables adding to a section this caller can't write to", () => {
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion("s1", "Vienna branch", false)]}
        onAdd={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add to Vienna branch" }),
    ).toBeDisabled();
    expect(screen.getByText("Read-only for you")).toBeInTheDocument();
  });

  it("closes by itself after a few seconds without adding anything", () => {
    const onAdd = vi.fn();
    const onDismiss = vi.fn();
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onAdd={onAdd}
        onDismiss={onDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(SECTION_PROMPT_DURATION_MS - 500);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDismiss).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("pauses the countdown while hovered", () => {
    const onDismiss = vi.fn();
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onAdd={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("region"));
    act(() => {
      vi.advanceTimersByTime(SECTION_PROMPT_DURATION_MS * 2);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(screen.getByRole("region"));
    act(() => {
      vi.advanceTimersByTime(SECTION_PROMPT_DURATION_MS + 100);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("closes shortly after every section was added", async () => {
    const onDismiss = vi.fn();
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onAdd={vi.fn().mockResolvedValue(undefined)}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add to Vienna branch" }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("pauses the countdown while focus is inside", () => {
    const onDismiss = vi.fn();
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onAdd={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    screen.getByRole("button", { name: "Add to Vienna branch" }).focus();
    act(() => {
      vi.advanceTimersByTime(SECTION_PROMPT_DURATION_MS * 2);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("the close button dismisses without adding", () => {
    const onAdd = vi.fn();
    const onDismiss = vi.fn();
    render(
      <NewMemberSectionPrompt
        memberName="Lea Adams"
        suggestions={[makeSuggestion()]}
        onAdd={onAdd}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
