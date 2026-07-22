import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { TreeService } from "@/services/TreeService";
import { type Member, type MemberDB } from "@/types/member";
import { type DuplicatePair, type MemberMergePreview } from "@/types/merge";
import { MergeMembersDialog } from "./MergeMembersDialog";

// Radix Select relies on scrollIntoView / hasPointerCapture, which jsdom
// doesn't implement.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- test-only polyfill
global.ResizeObserver = MockResizeObserver;

vi.mock("@/services/TreeService", () => ({
  TreeService: {
    getMemberMergePreview: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function makeAppMember(overrides: Partial<Member> = {}): Member {
  return {
    id: "a1",
    gender: "f",
    academicTitle: null,
    firstName: "Jo",
    middleNames: null,
    baptismalName: null,
    lastName: "Doe",
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
    ...overrides,
  };
}

const MEMBER_A: MemberDB = {
  id: "a1",
  gender: "f",
  academicTitle: null,
  firstName: "Jo",
  middleNames: null,
  baptismalName: null,
  lastName: "Doe",
  maidenName: null,
  imageData: null,
  dateOfBirth: null,
  dateOfDeath: null,
  deceased: false,
  adopted: false,
  isCollapsed: 0,
  positionX: 0,
  positionY: 0,
  linkedTreeId: null,
  linkedMemberId: null,
};

function memberB(overrides: Partial<MemberDB>): MemberDB {
  return { ...MEMBER_A, id: "b1", ...overrides };
}

function pair(overrides: Partial<DuplicatePair>): DuplicatePair {
  return {
    member_a: MEMBER_A,
    member_b: memberB({}),
    match: "exact",
    conflicts: [],
    default_action: "merge",
    ...overrides,
  };
}

function preview(overrides: Partial<MemberMergePreview>): MemberMergePreview {
  return {
    pair: pair({}),
    transfer: {
      relations: 0,
      events: 0,
      stories: 0,
      gallery: 0,
      documents: 0,
      tasks: 0,
      diseases: 0,
    },
    would_create_cycle: false,
    ...overrides,
  };
}

describe("MergeMembersDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    await i18n.changeLanguage("en");
    useTreeStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "editor" },
    });
    useMemberStore.setState({
      members: [makeAppMember({ id: "a1" }), makeAppMember({ id: "b1" })],
    });
    useQualityReportStore.setState({ mergeMembers: vi.fn() });
  });

  it("loads the preview for the first two members and shows transfer counts", async () => {
    vi.mocked(TreeService.getMemberMergePreview).mockResolvedValue(
      preview({
        transfer: {
          relations: 2,
          events: 1,
          stories: 0,
          gallery: 0,
          documents: 0,
          tasks: 0,
          diseases: 0,
        },
      }),
    );

    render(
      <MergeMembersDialog
        memberIds={["a1", "b1"]}
        open
        onOpenChange={vi.fn()}
        onMerged={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(TreeService.getMemberMergePreview).toHaveBeenCalledWith(
        "tree-1",
        "a1",
        "b1",
      ),
    );

    expect(await screen.findByText("2 relationships")).toBeInTheDocument();
    expect(screen.getByText("1 event")).toBeInTheDocument();
  });

  it("swaps keep/remove when the swap control is used", async () => {
    vi.mocked(TreeService.getMemberMergePreview).mockResolvedValue(preview({}));

    render(
      <MergeMembersDialog
        memberIds={["a1", "b1"]}
        open
        onOpenChange={vi.fn()}
        onMerged={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(TreeService.getMemberMergePreview).toHaveBeenCalledWith(
        "tree-1",
        "a1",
        "b1",
      ),
    );

    fireEvent.click(screen.getByTitle("Swap"));

    await waitFor(() =>
      expect(TreeService.getMemberMergePreview).toHaveBeenCalledWith(
        "tree-1",
        "b1",
        "a1",
      ),
    );
  });

  it("confirms the merge with the resolved field choices", async () => {
    vi.mocked(TreeService.getMemberMergePreview).mockResolvedValue(
      preview({
        pair: pair({
          member_a: { ...MEMBER_A, birthplace: "Vienna" },
          member_b: memberB({ birthplace: "Graz" }),
          match: "possible",
          conflicts: ["birthplace"],
        }),
      }),
    );
    const mergeMembers = vi.fn().mockResolvedValue(undefined);
    useQualityReportStore.setState({ mergeMembers });
    const onMerged = vi.fn();

    render(
      <MergeMembersDialog
        memberIds={["a1", "b1"]}
        open
        onOpenChange={vi.fn()}
        onMerged={onMerged}
      />,
    );

    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByText("Vienna")).toBeInTheDocument());
    expect(screen.getByText("Graz")).toBeInTheDocument();

    // "Keep both" makes no sense for an in-place merge of two specific
    // records, so the resolver's merge/keep-both toggle must not appear here.
    expect(screen.queryByText("Keep both")).not.toBeInTheDocument();

    const choiceSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("Use A"));
    expect(choiceSelect).toBeTruthy();
    fireEvent.click(choiceSelect!);
    fireEvent.click(await screen.findByText("Use B"));

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => {
      expect(mergeMembers).toHaveBeenCalledWith("a1", "b1", {
        birthplace: "b",
      });
    });
    expect(onMerged).toHaveBeenCalled();
  });

  it("shows an error message and disables Merge when the preview fails to load", async () => {
    vi.mocked(TreeService.getMemberMergePreview).mockRejectedValue(
      new Error("network error"),
    );

    render(
      <MergeMembersDialog
        memberIds={["a1", "b1"]}
        open
        onOpenChange={vi.fn()}
        onMerged={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    expect(
      await screen.findByText(
        "Could not load a preview for these members. Try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("shows the cycle warning and disables Merge when the preview flags one", async () => {
    vi.mocked(TreeService.getMemberMergePreview).mockResolvedValue(
      preview({ would_create_cycle: true }),
    );

    render(
      <MergeMembersDialog
        memberIds={["a1", "b1"]}
        open
        onOpenChange={vi.fn()}
        onMerged={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    expect(
      await screen.findByText(
        "This merge would create an impossible loop in the family tree.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("shows a picker when more than two members share the finding", async () => {
    vi.mocked(TreeService.getMemberMergePreview).mockResolvedValue(preview({}));
    useMemberStore.setState((s) => ({
      members: [...s.members, makeAppMember({ id: "c1" })],
    }));

    render(
      <MergeMembersDialog
        memberIds={["a1", "b1", "c1"]}
        open
        onOpenChange={vi.fn()}
        onMerged={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    // Picker mode renders two comboboxes (primary + duplicate selects).
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
  });
});
