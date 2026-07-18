import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { Member, MemberSearchHitDB } from "@/types/member";
import { CanvasSearch } from "./CanvasSearch";

const searchMembers = vi.fn();
const searchOtherTrees = vi.fn();

vi.mock("@/hooks/useMemberStore", () => ({
  useMemberStore: <T,>(
    selector: (state: {
      searchMembers: typeof searchMembers;
      searchOtherTrees: typeof searchOtherTrees;
    }) => T,
  ) => selector({ searchMembers, searchOtherTrees }),
}));

const CURRENT_MEMBER = {
  id: "current-maria",
  firstName: "Maria",
  lastName: "Current",
  maidenName: null,
  date: { birth: "1954", death: null },
} as Member;

const OTHER_TREE_MEMBER = {
  id: "other-maria",
  firstName: "Maria",
  lastName: "Huber",
  maidenName: "Leitner",
  dateOfBirth: "1954-03-12",
  treeId: "shared-tree",
  treeName: "Shared family",
} as MemberSearchHitDB;

describe("CanvasSearch", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  it("shows current-tree hits before starting and grouping other-tree hits", async () => {
    searchOtherTrees.mockResolvedValue([OTHER_TREE_MEMBER]);
    const onOpenOtherTree = vi.fn().mockResolvedValue(undefined);

    render(
      <CanvasSearch
        members={[CURRENT_MEMBER]}
        onLocate={vi.fn()}
        treeId="current-tree"
        onOpenOtherTree={onOpenOtherTree}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search members…"), {
      target: { value: "Maria" },
    });

    expect(screen.getByText("Maria Current")).toBeInTheDocument();
    expect(searchOtherTrees).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(searchOtherTrees).toHaveBeenCalledWith(
        "Maria",
        "current-tree",
        8,
        40,
      );
    });

    expect(screen.getByText("Current tree")).toBeInTheDocument();
    expect(screen.getByText("Other accessible trees")).toBeInTheDocument();
    expect(screen.getByText("Shared family")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Shared family and locate Maria Huber",
      }),
    );

    await waitFor(() => {
      expect(onOpenOtherTree).toHaveBeenCalledWith(
        "shared-tree",
        "other-maria",
      );
    });
  });
});
