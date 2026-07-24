import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTreeSharingStore } from "@/hooks/useTreeSharingStore";
import { type LinkedShareTree, type Tree, type TreeAccess } from "@/types/tree";
import { ShareTreeDialog } from "./ShareTreeDialog";

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

const OWNER_ACCESS: TreeAccess = {
  user_id: "owner-1",
  username: "owner",
  role: "owner",
  restrictions: [],
};
const OTHER_ACCESS: TreeAccess = {
  user_id: OTHER_USER.user_id,
  username: OTHER_USER.username,
  role: "editor",
  restrictions: [],
};

describe("ShareTreeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ features: ["sharing_invites", "tree_links"] });
    // `load` seeds access/candidates/invitations/linkedTrees in the real
    // store; here the dialog reads whatever state we seed directly, so a
    // no-op mock is enough — the point of this component test is the
    // dialog's own behavior, not the store's data-fetching (covered in
    // useTreeSharingStore.test.ts).
    useTreeSharingStore.setState({
      treeId: null,
      access: [OWNER_ACCESS, OTHER_ACCESS],
      candidates: [],
      invitations: [],
      linkedTrees: [],
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
      getLinkedShareTrees: vi.fn().mockResolvedValue([]),
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
    useTreeSharingStore.setState({ setPublicAccess });

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

  it("does not reload sharing data when the tree's public role changes while open", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    useTreeSharingStore.setState({ load });

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
    useTreeSharingStore.setState({ setPublicPassword });

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

  describe("linked trees", () => {
    const LINKED_MANAGEABLE: LinkedShareTree = {
      tree_id: "linked-1",
      name: "Linked Tree",
      member_count: 3,
      manageable: true,
      target_role: null,
    };

    const CANDIDATE = { user_id: "user-3", username: "carol" };

    beforeEach(() => {
      useTreeSharingStore.setState({
        access: [OWNER_ACCESS, OTHER_ACCESS],
        candidates: [CANDIDATE],
      });
    });

    it("renders the linked-trees section when a manageable linked tree exists", async () => {
      useTreeSharingStore.setState({ linkedTrees: [LINKED_MANAGEABLE] });

      render(
        <ShareTreeDialog
          tree={TREE}
          isOpen
          onClose={vi.fn()}
          onTreeUpdated={vi.fn()}
        />,
      );
      await screen.findByRole("dialog");

      // Stage a candidate so the linked-trees toggle becomes visible.
      fireEvent.click(screen.getByText("Select users…"));
      fireEvent.click(await screen.findByText("carol"));

      expect(
        await screen.findByText("Also share 1 linked tree"),
      ).toBeInTheDocument();
    });

    it("calls grantAccessBatch with the selected linked tree ids", async () => {
      const grantAccessBatch = vi.fn().mockResolvedValue([]);
      useTreeSharingStore.setState({
        linkedTrees: [LINKED_MANAGEABLE],
        grantAccessBatch,
      });

      render(
        <ShareTreeDialog
          tree={TREE}
          isOpen
          onClose={vi.fn()}
          onTreeUpdated={vi.fn()}
        />,
      );
      await screen.findByRole("dialog");

      fireEvent.click(screen.getByText("Select users…"));
      fireEvent.click(await screen.findByText("carol"));

      const linkedToggle = (
        await screen.findByText("Also share 1 linked tree")
      ).closest("div")!;
      const toggleSwitch = linkedToggle.querySelector('[role="switch"]')!;
      fireEvent.click(toggleSwitch);

      await screen.findByText("Linked Tree");

      fireEvent.click(screen.getByRole("button", { name: /Share with/ }));

      await waitFor(() => {
        expect(grantAccessBatch).toHaveBeenCalledWith(
          TREE.id,
          "carol",
          "editor",
          [TREE.id, "linked-1"],
        );
      });
    });

    it("offers linked tree removal when revoking access to a user with linked access", async () => {
      const getLinkedShareTrees = vi.fn(
        (_treeId: string, username?: string): Promise<LinkedShareTree[]> => {
          if (username) {
            return Promise.resolve([
              { ...LINKED_MANAGEABLE, target_role: "editor" },
            ]);
          }
          return Promise.resolve([LINKED_MANAGEABLE]);
        },
      );
      const revokeAccessBatch = vi.fn().mockResolvedValue(undefined);
      useTreeSharingStore.setState({
        linkedTrees: [LINKED_MANAGEABLE],
        getLinkedShareTrees,
        revokeAccessBatch,
      });

      render(
        <ShareTreeDialog
          tree={TREE}
          isOpen
          onClose={vi.fn()}
          onTreeUpdated={vi.fn()}
        />,
      );
      await screen.findByRole("dialog");

      const row = (await screen.findByText(OTHER_USER.username)).closest(
        "div",
      )!;
      const removeButton = row.querySelector('button[title="Remove access"]')!;
      fireEvent.click(removeButton);

      expect(
        await screen.findByText("Remove linked tree access too?"),
      ).toBeInTheDocument();
      expect(screen.getByText("Linked Tree")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Remove access" }));

      await waitFor(() => {
        expect(revokeAccessBatch).toHaveBeenCalledWith(
          TREE.id,
          OTHER_USER.user_id,
          [TREE.id, "linked-1"],
        );
      });
    });
  });
});
