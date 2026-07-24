import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("matches a reordered multi-token query in the current tree, like the server-backed search", async () => {
    searchOtherTrees.mockResolvedValue([]);
    const member = {
      id: "homer",
      firstName: "Homer 2",
      lastName: "Simpson",
      maidenName: null,
      date: { birth: "1956", death: null },
    } as Member;

    render(
      <CanvasSearch
        members={[member]}
        onLocate={vi.fn()}
        treeId="current-tree"
        onOpenOtherTree={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search members…"), {
      target: { value: "Simps 2" },
    });

    expect(screen.getByText("Homer 2 Simpson")).toBeInTheDocument();
  });

  it("matches a name token combined with a birth-year token in the current tree", async () => {
    searchOtherTrees.mockResolvedValue([]);
    const member = {
      id: "anna",
      firstName: "Anna",
      lastName: "Müller",
      maidenName: null,
      date: { birth: "12 May 1932", death: null },
    } as Member;

    render(
      <CanvasSearch
        members={[member]}
        onLocate={vi.fn()}
        treeId="current-tree"
        onOpenOtherTree={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search members…"), {
      target: { value: "Müller 1932" },
    });

    expect(screen.getByText("Anna Müller")).toBeInTheDocument();
  });

  it("matches a name token combined with a death-year token in the current tree", async () => {
    searchOtherTrees.mockResolvedValue([]);
    const member = {
      id: "anna",
      firstName: "Anna",
      lastName: "Müller",
      maidenName: null,
      date: { birth: "1901", death: "3 Jan 1999" },
    } as Member;

    render(
      <CanvasSearch
        members={[member]}
        onLocate={vi.fn()}
        treeId="current-tree"
        onOpenOtherTree={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search members…"), {
      target: { value: "Müller 1999" },
    });

    expect(screen.getByText("Anna Müller")).toBeInTheDocument();
  });
});
