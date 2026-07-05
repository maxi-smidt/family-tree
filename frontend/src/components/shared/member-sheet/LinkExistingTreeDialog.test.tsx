import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useTreeStore } from "@/hooks/useTreeStore";
import { TreeService } from "@/services/TreeService";
import { type Tree } from "@/types/tree";
import { type MemberDB } from "@/types/member";
import { LinkExistingTreeDialog } from "./LinkExistingTreeDialog";

// The MemberPicker's command palette (cmdk) relies on ResizeObserver, which
// jsdom doesn't implement.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- test-only polyfill
global.ResizeObserver = MockResizeObserver;

vi.mock("@/services/TreeService", () => ({
  TreeService: {
    getMembers: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const TARGET_TREE: Tree = {
  id: "tree-b",
  name: "Other Tree",
  role: "editor",
};

const CANDIDATE: MemberDB = {
  id: "b1",
  gender: "f",
  academicTitle: null,
  firstName: "Josephine",
  middleNames: null,
  baptismalName: null,
  lastName: "Dupont",
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

const ALREADY_LINKED_CANDIDATE: MemberDB = {
  ...CANDIDATE,
  id: "b2",
  firstName: "Already",
  lastName: "Linked",
  linkedTreeId: "tree-c",
};

describe("LinkExistingTreeDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    await i18n.changeLanguage("en");
    useTreeStore.setState({ linkExistingTree: vi.fn() });
    vi.mocked(TreeService.getMembers).mockResolvedValue([
      CANDIDATE,
      ALREADY_LINKED_CANDIDATE,
    ]);
  });

  it("fetches and lists linkable members for the find-existing mode", async () => {
    render(
      <LinkExistingTreeDialog
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
      expect(TreeService.getMembers).toHaveBeenCalledWith("tree-b", true),
    );

    // Open the member picker and confirm the already-linked candidate is
    // filtered out (cannot hijack another link's bridge person).
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Josephine Dupont")).toBeInTheDocument();
    expect(screen.queryByText("Already Linked")).not.toBeInTheDocument();
  });

  it("switches to the create-copy mode and confirms without a counterpart selection", async () => {
    const linkExistingTree = vi.fn().mockResolvedValue(TARGET_TREE);
    useTreeStore.setState({ linkExistingTree });
    const onLinked = vi.fn();

    render(
      <LinkExistingTreeDialog
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
      });
    });
    expect(onLinked).toHaveBeenCalled();
  });

  it("renders a read-only no-access state for a viewer-only target tree", async () => {
    render(
      <LinkExistingTreeDialog
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
  });
});
