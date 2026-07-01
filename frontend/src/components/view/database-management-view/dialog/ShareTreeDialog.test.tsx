import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useAuthStore } from "@/hooks/useAuthStore";
import { type Tree } from "@/types/tree";
import { ShareTreeDialog } from "./ShareTreeDialog";
import { TreeSharingService } from "@/services/TreeSharingService";

vi.mock("@/services/TreeSharingService", () => ({
  TreeSharingService: {
    getSharingData: vi.fn(),
    listInvitations: vi.fn(),
    setPublicAccess: vi.fn(),
    grantAccess: vi.fn(),
    revokeAccess: vi.fn(),
    transferOwnership: vi.fn(),
    updateMemberRestrictions: vi.fn(),
    createInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    revertTransfer: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/useTreeStore", () => ({
  useTreeStore: {
    getState: () => ({
      loadTrees: vi.fn(),
    }),
  },
}));

const TREE: Tree = {
  id: "tree-1",
  name: "Family Tree",
  role: "owner",
  public_role: null,
};

const OTHER_USER = {
  user_id: "user-2",
  username: "other-user",
};

describe("ShareTreeDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    await i18n.changeLanguage("en");
    useAuthStore.setState({ features: ["sharing_invites"] });
    vi.mocked(TreeSharingService.getSharingData).mockResolvedValue({
      access: [
        {
          user_id: "owner-1",
          username: "owner",
          role: "owner",
          restrictions: [],
        },
        {
          user_id: OTHER_USER.user_id,
          username: OTHER_USER.username,
          role: "editor",
          restrictions: [],
        },
      ],
      candidates: [],
    });
    vi.mocked(TreeSharingService.listInvitations).mockResolvedValue([]);
  });

  it("keeps the share dialog open and shows the link after enabling public access", async () => {
    const onClose = vi.fn();
    const onTreeUpdated = vi.fn();
    vi.mocked(TreeSharingService.setPublicAccess).mockResolvedValue({
      ...TREE,
      public_role: "viewer",
    });

    render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={onClose}
        onTreeUpdated={onTreeUpdated}
      />,
    );

    await screen.findByRole("dialog");

    // Toggle the public access switch (first switch in the dialog).
    const [publicSwitch] = screen.getAllByRole("switch");
    fireEvent.click(publicSwitch);

    // Confirm in the nested alert dialog.
    fireEvent.click(await screen.findByRole("button", { name: "Make public" }));

    await waitFor(() => {
      expect(TreeSharingService.setPublicAccess).toHaveBeenCalledWith(
        TREE.id,
        "viewer",
      );
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onTreeUpdated).toHaveBeenCalledWith({
      ...TREE,
      public_role: "viewer",
    });
    expect(screen.getByText(/#public=tree-1$/)).toBeInTheDocument();
  });

  it("does not reload sharing data when the tree's public role changes while open", async () => {
    const { rerender } = render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={vi.fn()}
        onTreeUpdated={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(TreeSharingService.getSharingData).toHaveBeenCalledTimes(1),
    );

    // Simulate the parent re-rendering with an updated tree after the public
    // toggle is confirmed. This must NOT trigger another data fetch (#517).
    rerender(
      <ShareTreeDialog
        tree={{ ...TREE, public_role: "viewer" }}
        isOpen
        onClose={vi.fn()}
        onTreeUpdated={vi.fn()}
      />,
    );

    expect(TreeSharingService.getSharingData).toHaveBeenCalledTimes(1);
  });

  it("keeps the share dialog open when public access confirmation is canceled", async () => {
    const onClose = vi.fn();

    render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={onClose}
        onTreeUpdated={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");

    const [publicSwitch] = screen.getAllByRole("switch");
    fireEvent.click(publicSwitch);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the share dialog open when the transfer confirmation is open", async () => {
    const onClose = vi.fn();

    render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={onClose}
        onTreeUpdated={vi.fn()}
      />,
    );

    await screen.findByText("Transfer ownership");

    // Open the transfer select dropdown and pick a target.
    fireEvent.click(
      screen.getByRole("combobox", { name: /Select a new owner/ }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "other-user" }));

    // Open the transfer confirmation.
    fireEvent.click(screen.getByRole("button", { name: /^Transfer$/ }));

    await screen.findByText("Transfer ownership?");

    // While the confirmation is open, the main dialog should still be rendered.
    expect(screen.getByText('Share "Family Tree"')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the share dialog when no nested dialog is open", async () => {
    const onClose = vi.fn();

    const { rerender } = render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={onClose}
        onTreeUpdated={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");

    // Simulate Radix calling onOpenChange(false) by closing the dialog via props.
    rerender(
      <ShareTreeDialog
        tree={TREE}
        isOpen={false}
        onClose={onClose}
        onTreeUpdated={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
