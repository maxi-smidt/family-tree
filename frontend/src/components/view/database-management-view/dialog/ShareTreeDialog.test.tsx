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

const TREE: Tree = {
  id: "tree-1",
  name: "Family Tree",
  role: "owner",
  public_role: null,
};

describe("ShareTreeDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
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
      ],
      candidates: [],
    });
    vi.mocked(TreeSharingService.listInvitations).mockResolvedValue([]);
  });

  it("keeps the share dialog open after confirming public access", async () => {
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

    await screen.findByText("Public read-only access");

    fireEvent.click(screen.getAllByRole("switch")[0]);
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
});
