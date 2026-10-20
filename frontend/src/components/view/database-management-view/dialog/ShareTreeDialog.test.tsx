import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSharingStore } from "@/hooks/useWorkspaceSharingStore";
import { type Workspace, type WorkspaceAccess } from "@/types/workspace";
import { ShareTreeDialog } from "./ShareTreeDialog";
import { SectionDB } from "@/types/section";

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

const SECTION: SectionDB = {
  id: "section-1",
  workspace_id: TREE.id,
  name: "Smith branch",
  position: 0,
  created_at: "2026-01-01T00:00:00Z",
  member_count: 3,
  can_write: true,
};

const selectTab = (name: string) => {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), {
    button: 0,
    ctrlKey: false,
  });
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
  read_only: [],
  section_id: null,
};
const OTHER_ACCESS: WorkspaceAccess = {
  user_id: OTHER_USER.user_id,
  username: OTHER_USER.username,
  role: "editor",
  restrictions: [],
  read_only: [],
  section_id: null,
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
      sections: [],
      invitations: [],
      loading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
      grantAccess: vi.fn(),
      revokeAccess: vi.fn(),
      updateMemberRestrictions: vi.fn(),
      updateMemberLevels: vi.fn(),
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

  it("starts with people and reveals one sharing method at a time", () => {
    render(<ShareTreeDialog tree={TREE} isOpen onClose={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("combobox", { name: /Select users/ }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Create invite link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Transfer ownership").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.queryByRole("switch", { name: "Public read-only access" }),
    ).not.toBeInTheDocument();

    selectTab("Invite link");
    expect(
      screen.getByRole("button", { name: "Create invite link" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("People with access")).not.toBeInTheDocument();

    selectTab("Public link");
    expect(
      screen.getByRole("switch", { name: "Public read-only access" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create invite link" }),
    ).not.toBeInTheDocument();
  });

  it("preserves invitation settings while switching methods and resets on reopening", async () => {
    const { rerender } = render(
      <ShareTreeDialog tree={TREE} isOpen onClose={vi.fn()} />,
    );
    selectTab("Invite link");
    fireEvent.change(screen.getByLabelText("Email address (optional)"), {
      target: { value: "anna@example.com" },
    });
    selectTab("People");
    selectTab("Invite link");
    expect(screen.getByLabelText("Email address (optional)")).toHaveValue(
      "anna@example.com",
    );

    rerender(<ShareTreeDialog tree={TREE} isOpen={false} onClose={vi.fn()} />);
    rerender(<ShareTreeDialog tree={TREE} isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    selectTab("Invite link");
    expect(screen.getByLabelText("Email address (optional)")).toHaveValue("");
  });

  it("creates an invitation from its dedicated panel", async () => {
    const createInvitation = vi.fn().mockResolvedValue(undefined);
    useWorkspaceSharingStore.setState({ createInvitation });
    render(<ShareTreeDialog tree={TREE} isOpen onClose={vi.fn()} />);
    selectTab("Invite link");
    fireEvent.change(screen.getByLabelText("Email address (optional)"), {
      target: { value: "anna@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    await waitFor(() =>
      expect(createInvitation).toHaveBeenCalledWith(TREE.id, {
        email: "anna@example.com",
        role: "editor",
        expiresInDays: undefined,
      }),
    );
  });

  it("shares a selected friend after switching tabs", async () => {
    const grantAccess = vi.fn().mockResolvedValue([]);
    const updateMemberLevels = vi.fn().mockResolvedValue([]);
    useWorkspaceSharingStore.setState({
      access: [OWNER_ACCESS],
      candidates: [OTHER_USER],
      grantAccess,
      updateMemberLevels,
    });
    render(<ShareTreeDialog tree={TREE} isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: /Select users/ }));
    fireEvent.click(
      await screen.findByRole("option", { name: OTHER_USER.username }),
    );
    fireEvent.keyDown(screen.getByPlaceholderText("Search users…"), {
      key: "Escape",
    });
    selectTab("Invite link");
    selectTab("People");
    fireEvent.click(
      screen.getByRole("button", { name: "Share with 1 person" }),
    );
    await waitFor(() =>
      expect(grantAccess).toHaveBeenCalledWith(
        TREE.id,
        OTHER_USER.username,
        "editor",
        undefined,
      ),
    );
    expect(updateMemberLevels).toHaveBeenCalled();
  });

  it("hides ownership and link settings for non-owners", () => {
    render(
      <ShareTreeDialog
        tree={{ ...TREE, role: "editor" }}
        isOpen
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("People with access")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Invite link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Public link" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Transfer ownership")).not.toBeInTheDocument();
  });

  it("closes with Done", () => {
    const onClose = vi.fn();
    render(<ShareTreeDialog tree={TREE} isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shares only the requested section with a friend who has access to another section", async () => {
    const grantAccess = vi.fn().mockResolvedValue([]);
    const updateMemberLevels = vi.fn().mockResolvedValue([]);
    useWorkspaceSharingStore.setState({
      access: [OWNER_ACCESS, { ...OTHER_ACCESS, section_id: "other-section" }],
      candidates: [OTHER_USER],
      sections: [SECTION],
      grantAccess,
      updateMemberLevels,
    });
    render(
      <ShareTreeDialog
        tree={TREE}
        section={SECTION}
        isOpen
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: 'Share "Smith branch"' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Invite link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Public link" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Transfer ownership")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: /Select users/ }));
    fireEvent.click(
      await screen.findByRole("option", { name: OTHER_USER.username }),
    );
    fireEvent.keyDown(screen.getByPlaceholderText("Search users…"), {
      key: "Escape",
    });
    expect(
      screen.queryByRole("combobox", { name: "Access to" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Share with 1 person" }),
    );
    await waitFor(() =>
      expect(grantAccess).toHaveBeenCalledWith(
        TREE.id,
        OTHER_USER.username,
        "editor",
        [SECTION.id],
      ),
    );
    expect(updateMemberLevels).toHaveBeenCalledWith(
      TREE.id,
      OTHER_USER.user_id,
      expect.any(Object),
      SECTION.id,
    );
    expect(useWorkspaceSharingStore.getState().load).toHaveBeenCalledWith(
      TREE.id,
      { includeInvitations: false },
    );
  });

  it("shows inherited workspace access without controls and only revokes the selected section", async () => {
    const revokeAccess = vi.fn().mockResolvedValue(undefined);
    useWorkspaceSharingStore.setState({
      access: [
        OWNER_ACCESS,
        OTHER_ACCESS,
        {
          ...OTHER_ACCESS,
          user_id: "section-user",
          username: "section-person",
          section_id: SECTION.id,
        },
        {
          ...OTHER_ACCESS,
          user_id: "unrelated-user",
          username: "other-section-person",
          section_id: "other-section",
        },
      ],
      sections: [SECTION],
      candidates: [OTHER_USER],
      revokeAccess,
    });
    render(
      <ShareTreeDialog
        tree={TREE}
        section={SECTION}
        isOpen
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Via whole workspace")).toBeInTheDocument();
    expect(screen.getByText("section-person")).toBeInTheDocument();
    expect(screen.queryByText("other-section-person")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Select users/ }),
    ).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: "Access: Custom" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    await waitFor(() =>
      expect(revokeAccess).toHaveBeenCalledWith(
        TREE.id,
        "section-user",
        SECTION.id,
      ),
    );
  });

  it("updates permissions only for the selected section grant", async () => {
    const access = [OWNER_ACCESS, { ...OTHER_ACCESS, section_id: SECTION.id }];
    const updateMemberLevels = vi.fn().mockResolvedValue(access);
    useWorkspaceSharingStore.setState({
      access,
      sections: [SECTION],
      updateMemberLevels,
    });
    render(
      <ShareTreeDialog
        tree={TREE}
        section={SECTION}
        isOpen
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Access: Custom" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tree only" }));
    await waitFor(() =>
      expect(updateMemberLevels).toHaveBeenCalledWith(
        TREE.id,
        OTHER_USER.user_id,
        expect.objectContaining({ tree: "view", gallery: "hidden" }),
        SECTION.id,
      ),
    );
  });

  it("applies a preset to a person's access", async () => {
    const updateMemberLevels = vi
      .fn()
      .mockResolvedValue([OWNER_ACCESS, OTHER_ACCESS]);
    useWorkspaceSharingStore.setState({ updateMemberLevels });

    render(<ShareTreeDialog tree={TREE} isOpen onClose={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Access: Custom" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tree only" }));

    await waitFor(() =>
      expect(updateMemberLevels).toHaveBeenCalledWith(
        TREE.id,
        OTHER_USER.user_id,
        {
          tree: "view",
          gallery: "hidden",
          sources: "hidden",
          stories: "hidden",
          events: "hidden",
          diseases: "hidden",
          tasks: "hidden",
        },
        null,
      ),
    );
  });

  it("labels a section-scoped grant and revokes only that section", async () => {
    const revokeAccess = vi.fn().mockResolvedValue(undefined);
    useWorkspaceSharingStore.setState({
      access: [
        OWNER_ACCESS,
        { ...OTHER_ACCESS, role: "viewer", section_id: "section-1" },
      ],
      sections: [
        {
          id: "section-1",
          workspace_id: TREE.id,
          name: "Smith branch",
          position: 0,
          created_at: "2026-01-01T00:00:00Z",
          member_count: 3,
          can_write: true,
        },
      ],
      revokeAccess,
    });

    render(<ShareTreeDialog tree={TREE} isOpen onClose={vi.fn()} />);

    expect(await screen.findByText("Smith branch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));

    await waitFor(() =>
      expect(revokeAccess).toHaveBeenCalledWith(
        TREE.id,
        OTHER_USER.user_id,
        "section-1",
      ),
    );
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

    selectTab("Public link");
    fireEvent.click(
      screen.getByRole("switch", { name: "Public read-only access" }),
    );

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

    selectTab("Public link");
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

    selectTab("Public link");
    fireEvent.click(
      screen.getByRole("switch", { name: "Public read-only access" }),
    );

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

    fireEvent.click(await screen.findByText("Transfer ownership"));

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
