import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useTreeStore } from "@/hooks/useTreeStore";
import { TreeService } from "@/services/TreeService";
import { type Tree } from "@/types/tree";
import { type MemberDB } from "@/types/member";
import { type DuplicatePair } from "@/types/merge";
import { LinkExistingTreeDialog } from "./LinkExistingTreeDialog";

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
    getLinkCandidates: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const SOURCE_TREE_ID = "tree-a";

const TARGET_TREE: Tree = {
  id: "tree-b",
  name: "Other Tree",
  role: "editor",
};

const SOURCE_MEMBER: MemberDB = {
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

function candidate(overrides: Partial<MemberDB>): MemberDB {
  return {
    ...SOURCE_MEMBER,
    id: "b1",
    firstName: "Jo",
    lastName: "Doe",
    ...overrides,
  };
}

function pair(overrides: Partial<DuplicatePair>): DuplicatePair {
  return {
    member_a: SOURCE_MEMBER,
    member_b: candidate({}),
    match: "exact",
    conflicts: [],
    default_action: "merge",
    ...overrides,
  };
}

describe("LinkExistingTreeDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    await i18n.changeLanguage("en");
    useTreeStore.setState({ linkExistingTree: vi.fn() });
  });

  it("fetches and lists only same-named candidates for the find-existing mode", async () => {
    vi.mocked(TreeService.getLinkCandidates).mockResolvedValue({
      candidates: [
        pair({
          member_b: candidate({ id: "b1", firstName: "Jo", lastName: "Doe" }),
          match: "exact",
        }),
      ],
    });

    render(
      <LinkExistingTreeDialog
        sourceTreeId={SOURCE_TREE_ID}
        memberId="a1"
        memberName="Jo Doe"
        tree={TARGET_TREE}
        open
        onOpenChange={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(TreeService.getLinkCandidates).toHaveBeenCalledWith(
        SOURCE_TREE_ID,
        "a1",
        "tree-b",
      ),
    );

    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Jo Doe")).toBeInTheDocument();
  });

  it("shows the no-candidates nudge toward Create a copy when nothing matches", async () => {
    vi.mocked(TreeService.getLinkCandidates).mockResolvedValue({
      candidates: [],
    });

    render(
      <LinkExistingTreeDialog
        sourceTreeId={SOURCE_TREE_ID}
        memberId="a1"
        memberName="Jo Doe"
        tree={TARGET_TREE}
        open
        onOpenChange={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    expect(
      await screen.findByText(/No one named Jo Doe was found in/),
    ).toBeInTheDocument();
    // Nothing to select, so Link stays disabled in "existing" mode.
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  });

  it("shows the conflict resolver for a conflicting candidate and sends chosen field_choices", async () => {
    vi.mocked(TreeService.getLinkCandidates).mockResolvedValue({
      candidates: [
        pair({
          member_a: { ...SOURCE_MEMBER, birthplace: "Vienna" },
          member_b: candidate({ id: "b1", birthplace: "Graz" }),
          match: "possible",
          conflicts: ["birthplace"],
        }),
      ],
    });
    const linkExistingTree = vi.fn().mockResolvedValue(TARGET_TREE);
    useTreeStore.setState({ linkExistingTree });
    const onLinked = vi.fn();

    render(
      <LinkExistingTreeDialog
        sourceTreeId={SOURCE_TREE_ID}
        memberId="a1"
        memberName="Jo Doe"
        tree={TARGET_TREE}
        open
        onOpenChange={vi.fn()}
        onLinked={onLinked}
      />,
    );

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Jo Doe"));

    // The conflict resolver appears with both sides' birthplace values.
    expect(await screen.findByText("Vienna")).toBeInTheDocument();
    expect(screen.getByText("Graz")).toBeInTheDocument();

    // Choose "Use B" for the conflicting field.
    const choiceSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("Use A"));
    expect(choiceSelect).toBeTruthy();
    fireEvent.click(choiceSelect!);
    fireEvent.click(await screen.findByText("Use B"));

    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(linkExistingTree).toHaveBeenCalledWith("a1", {
        linked_tree_id: "tree-b",
        mode: "existing",
        counterpart_member_id: "b1",
        field_choices: { birthplace: "b" },
      });
    });
    expect(onLinked).toHaveBeenCalled();
  });

  it("links directly without a resolver when the candidate has no conflicts", async () => {
    vi.mocked(TreeService.getLinkCandidates).mockResolvedValue({
      candidates: [
        pair({
          member_b: candidate({ id: "b1" }),
          match: "exact",
          conflicts: [],
        }),
      ],
    });
    const linkExistingTree = vi.fn().mockResolvedValue(TARGET_TREE);
    useTreeStore.setState({ linkExistingTree });

    render(
      <LinkExistingTreeDialog
        sourceTreeId={SOURCE_TREE_ID}
        memberId="a1"
        memberName="Jo Doe"
        tree={TARGET_TREE}
        open
        onOpenChange={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Jo Doe"));

    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(linkExistingTree).toHaveBeenCalledWith("a1", {
        linked_tree_id: "tree-b",
        mode: "existing",
        counterpart_member_id: "b1",
        field_choices: {},
      });
    });
  });

  it("switches to the create-copy mode and confirms without a counterpart selection", async () => {
    vi.mocked(TreeService.getLinkCandidates).mockResolvedValue({
      candidates: [],
    });
    const linkExistingTree = vi.fn().mockResolvedValue(TARGET_TREE);
    useTreeStore.setState({ linkExistingTree });
    const onLinked = vi.fn();

    render(
      <LinkExistingTreeDialog
        sourceTreeId={SOURCE_TREE_ID}
        memberId="a1"
        memberName="Jo Doe"
        tree={TARGET_TREE}
        open
        onOpenChange={vi.fn()}
        onLinked={onLinked}
      />,
    );

    await screen.findByRole("dialog");
    const createTab = screen.getByRole("tab", { name: "Create a copy" });
    fireEvent.mouseDown(createTab, { button: 0 });
    fireEvent.mouseUp(createTab, { button: 0 });
    fireEvent.click(createTab);
    await waitFor(() =>
      expect(createTab).toHaveAttribute("aria-selected", "true"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(linkExistingTree).toHaveBeenCalledWith("a1", {
        linked_tree_id: "tree-b",
        mode: "create",
        counterpart_member_id: undefined,
        field_choices: undefined,
      });
    });
    expect(onLinked).toHaveBeenCalled();
  });

  it("renders a read-only no-access state for a viewer-only target tree", async () => {
    render(
      <LinkExistingTreeDialog
        sourceTreeId={SOURCE_TREE_ID}
        memberId="a1"
        memberName="Jo Doe"
        tree={{ ...TARGET_TREE, role: "viewer" }}
        open
        onOpenChange={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    expect(
      screen.getByText(/You need edit access to “Other Tree”/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Link" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(TreeService.getLinkCandidates).not.toHaveBeenCalled();
  });
});
