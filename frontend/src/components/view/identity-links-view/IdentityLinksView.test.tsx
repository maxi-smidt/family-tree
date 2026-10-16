import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { IdentityLinkService } from "@/services/IdentityLinkService";
import { IdentityLinkClaim } from "@/types/identityLink";
import { Workspace } from "@/types/workspace";
import { IdentityLinksView } from "./IdentityLinksView";

vi.mock("@/services/IdentityLinkService");

const OWNED_WORKSPACE: Workspace = {
  id: "owned",
  name: "My family",
  role: "owner",
};
const SHARED_WORKSPACE: Workspace = {
  id: "shared",
  name: "Shared family",
  role: "editor",
};
const CLAIM: IdentityLinkClaim = {
  id: "claim-1",
  status: "pending",
  source_workspace_id: "source",
  source_workspace_name: "Another family",
  source_member_id: "member-1",
  source_display_name: "Ada",
  proposer_username: "alice",
  target_username: "bob",
  note: null,
  created_at: "2026-01-01T00:00:00Z",
  expires_at: null,
  decided_at: null,
  decision_reason: null,
  resulting_identity_link_id: null,
};

describe("IdentityLinksView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIdentityLinkStore.getState().clear();
    useWorkspaceStore.setState({ workspaces: [], selectedTree: undefined });
    vi.mocked(IdentityLinkService.listForWorkspace).mockResolvedValue([]);
    vi.mocked(IdentityLinkService.listIncomingClaims).mockResolvedValue([]);
    vi.mocked(IdentityLinkService.listOutgoingClaims).mockResolvedValue([]);
  });

  afterEach(cleanup);

  // Keep the real workspace-store hook and completion dialog: replacing
  // either would hide an unstable selector even while the dialog is closed.
  it.each([
    { label: "no selected workspace", workspace: undefined },
    { label: "an owned workspace", workspace: OWNED_WORKSPACE },
  ])("opens with $label and no claim selected", async ({ workspace }) => {
    useWorkspaceStore.setState({
      workspaces: workspace ? [workspace] : [],
      selectedTree: workspace,
    });

    await act(async () => {
      render(<IdentityLinksView />);
    });

    expect(
      screen.getByRole("heading", { name: "Identity links" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(IdentityLinkService.listIncomingClaims).toHaveBeenCalledOnce();
    if (workspace) {
      expect(IdentityLinkService.listForWorkspace).toHaveBeenCalledWith(
        workspace.id,
      );
    }
  });

  it("opens an incoming claim and updates its owned-workspace choices", async () => {
    useWorkspaceStore.setState({
      workspaces: [OWNED_WORKSPACE, SHARED_WORKSPACE],
      selectedTree: OWNED_WORKSPACE,
    });
    vi.mocked(IdentityLinkService.listIncomingClaims).mockResolvedValue([
      CLAIM,
    ]);

    await act(async () => {
      render(<IdentityLinksView />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose my member" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });

    expect(
      await screen.findByRole("option", { name: OWNED_WORKSPACE.name }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: SHARED_WORKSPACE.name }),
    ).not.toBeInTheDocument();

    act(() => {
      useWorkspaceStore.setState({
        workspaces: [
          { ...OWNED_WORKSPACE, name: "Renamed family" },
          SHARED_WORKSPACE,
        ],
      });
    });
    expect(
      screen.getByRole("option", { name: "Renamed family" }),
    ).toBeInTheDocument();
  });
});
