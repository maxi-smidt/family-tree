import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSharingStore } from "@/hooks/useWorkspaceSharingStore";
import { type Workspace, type WorkspaceAccess } from "@/types/workspace";
import { ShareTreeDialog } from "./ShareTreeDialog";

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      loadTrees: vi.fn(),
    }),
  },
}));

const TREE: Workspace = {
  id: "tree-1",
  name: "Family Workspace",
  role: "owner",
  public_role: null,
};

const OTHER_USER = {
  user_id: "user-2",
  username: "other-user",
};

const OWNER_ACCESS: WorkspaceAccess = {
  user_id: "owner-1",
  username: "owner",
  role: "owner",
  restrictions: [],
};
const OTHER_ACCESS: WorkspaceAccess = {
  user_id: OTHER_USER.user_id,
  username: OTHER_USER.username,
  role: "editor",
  restrictions: [],
};

describe("ShareTreeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `load` seeds access/candidates/invitations in the real store; here the
    // dialog reads whatever state we seed directly, so a no-op mock is enough
    // — the point of this component test is the dialog's own behavior, not
    // the store's data-fetching (covered in useWorkspaceSharingStore.test.ts).
    useWorkspaceSharingStore.setState({
      workspaceId: null,
      access: [OWNER_ACCESS, OTHER_ACCESS],
      candidates: [],
      invitations: [],
      loading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
      grantAccess: vi.fn(),
      revokeAccess: vi.fn(),
      updateMemberRestrictions: vi.fn(),
      transferOwnership: vi.fn(),
      revertTransfer: vi.fn(),
      createInvitation: vi.fn(),
      revokeInvitation: vi.fn(),
      setPublicAccess: vi.fn(),
      setPublicPassword: vi.fn(),
      grantAccessBatch: vi.fn(),
      revokeAccessBatch: vi.fn(),
    });
  });

  it("keeps the share dialog open and shows the link after enabling public access", async () => {
    const onClose = vi.fn();
    const onTreeUpdated = vi.fn();
    const setPublicAccess = vi
      .fn()
      .mockResolvedValue({ ...TREE, public_role: "viewer" });
    useWorkspaceSharingStore.setState({ setPublicAccess });

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
    expect(
      await screen.findByText(
        "Anyone with this link can view names, profile photos, gender, birth and death dates, and family relationships without an account.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "I understand — make public" }),
    );

    await waitFor(() => {
      expect(setPublicAccess).toHaveBeenCalledWith(TREE.id, "viewer");
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onTreeUpdated).toHaveBeenCalledWith({
      ...TREE,
      public_role: "viewer",
    });
    expect(await screen.findByText(/#public=tree-1$/)).toBeInTheDocument();
  });

  it("only applies the wide minimum width from the sm breakpoint up, so phone-width viewports aren't forced to overflow (#879)", async () => {
    render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={vi.fn()}
        onTreeUpdated={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveClass("sm:min-w-[600px]");
    expect(dialog).not.toHaveClass("min-w-[600px]");
  });

  it("lets a member row wrap its controls instead of forcing horizontal overflow (#879)", async () => {
    render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={vi.fn()}
        onTreeUpdated={vi.fn()}
      />,
    );

    const row = (await screen.findByText(OTHER_USER.username)).closest(
      "div.flex",
    ) as HTMLElement;

    expect(row).toHaveClass("flex-wrap");
    expect(screen.getByText(OTHER_USER.username)).toHaveClass("truncate");
  });

  it("stacks the transfer-ownership controls on mobile instead of overflowing (#879)", async () => {
    render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={vi.fn()}
        onTreeUpdated={vi.fn()}
      />,
    );

    const transferSelect = await screen.findByRole("combobox", {
      name: /Select a new owner/,
    });

    expect(transferSelect.closest("div.flex")).toHaveClass(
      "flex-col",
      "sm:flex-row",
    );
    expect(transferSelect).toHaveClass("w-full", "min-w-0");
  });

  it("does not reload sharing data when the tree's public role changes while open", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    useWorkspaceSharingStore.setState({ load });

    const { rerender } = render(
      <ShareTreeDialog
        tree={TREE}
        isOpen
        onClose={vi.fn()}
        onTreeUpdated={vi.fn()}
      />,
    );

    await screen.findByRole("dialog");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

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

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows the public password requirement before submitting", async () => {
    const setPublicPassword = vi.fn();
    useWorkspaceSharingStore.setState({ setPublicPassword });

    render(
      <ShareTreeDialog
        tree={{ ...TREE, public_role: "viewer" }}
        isOpen
        onClose={vi.fn()}
        onTreeUpdated={vi.fn()}
      />,
    );

    const passwordInput = await screen.findByPlaceholderText("New password");
    fireEvent.change(passwordInput, { target: { value: "short" } });

    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set password" })).toBeDisabled();
    expect(setPublicPassword).not.toHaveBeenCalled();
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
    expect(screen.getByText('Share "Family Workspace"')).toBeInTheDocument();
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
