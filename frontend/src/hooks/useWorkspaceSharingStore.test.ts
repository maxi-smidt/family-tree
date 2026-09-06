import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/WorkspaceSharingService", () => ({
  WorkspaceSharingService: {
    getSharingData: vi.fn(),
    listInvitations: vi.fn(),
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
  },
}));

import { WorkspaceSharingService } from "@/services/WorkspaceSharingService";
import type { Workspace, WorkspaceAccess, WorkspaceInvitation, WorkspaceTransferResult } from "@/types/workspace";
import { useWorkspaceSharingStore } from "./useWorkspaceSharingStore";

describe("useWorkspaceSharingStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceSharingStore.setState({
      workspaceId: null,
      access: [],
      candidates: [],
      invitations: [],
      loading: false,
      error: null,
    });
  });

  it("does not apply a stale sharing response after changing workspaces", async () => {
    let resolveFirst: (value: { access: []; candidates: [] }) => void = () =>
      undefined;
    vi.mocked(WorkspaceSharingService.getSharingData)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        access: [
          {
            user_id: "user-2",
            username: "new-tree-user",
            role: "viewer",
            restrictions: [],
          },
        ],
        candidates: [],
      });

    const first = useWorkspaceSharingStore.getState().load("tree-1", {
      includeInvitations: false,
    });
    await useWorkspaceSharingStore.getState().load("tree-2", {
      includeInvitations: false,
    });
    resolveFirst({ access: [], candidates: [] });
    await first;

    expect(useWorkspaceSharingStore.getState()).toMatchObject({
      workspaceId: "tree-2",
      access: [expect.objectContaining({ username: "new-tree-user" })],
    });
  });

  it("clears the previous tree's sharing data while loading another tree", async () => {
    let resolveLoad: (value: { access: []; candidates: [] }) => void = () =>
      undefined;
    useWorkspaceSharingStore.setState({
      workspaceId: "tree-1",
      access: [
        {
          user_id: "user-1",
          username: "previous-tree-user",
          role: "editor",
          restrictions: [],
        },
      ],
    });
    vi.mocked(WorkspaceSharingService.getSharingData).mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const loading = useWorkspaceSharingStore.getState().load("tree-2", {
      includeInvitations: false,
    });

    expect(useWorkspaceSharingStore.getState().access).toEqual([]);
    resolveLoad({ access: [], candidates: [] });
    await loading;
  });
});

// Every action below is a thin `run(workspaceId, () => WorkspaceSharingService.x(...))`
// wrapper — these tests confirm each one forwards its args to the right
// service method and resolves with its return value. Component tests
// (ShareTreeDialog.test.tsx) mock this store directly rather than
// WorkspaceSharingService, so this is the only place these wrappers are covered.
describe("useWorkspaceSharingStore — action wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grantAccess forwards to WorkspaceSharingService.grantAccess", async () => {
    const access: WorkspaceAccess[] = [
      { user_id: "user-2", username: "bob", role: "editor", restrictions: [] },
    ];
    vi.mocked(WorkspaceSharingService.grantAccess).mockResolvedValue(access);

    const result = await useWorkspaceSharingStore
      .getState()
      .grantAccess("tree-1", "bob", "editor");

    expect(WorkspaceSharingService.grantAccess).toHaveBeenCalledWith(
      "tree-1",
      "bob",
      "editor",
    );
    expect(result).toBe(access);
  });

  it("revokeAccess forwards to WorkspaceSharingService.revokeAccess", async () => {
    vi.mocked(WorkspaceSharingService.revokeAccess).mockResolvedValue(undefined);

    await useWorkspaceSharingStore.getState().revokeAccess("tree-1", "user-2");

    expect(WorkspaceSharingService.revokeAccess).toHaveBeenCalledWith(
      "tree-1",
      "user-2",
    );
  });

  it("updateMemberRestrictions forwards to WorkspaceSharingService.updateMemberRestrictions", async () => {
    const access: WorkspaceAccess[] = [];
    vi.mocked(WorkspaceSharingService.updateMemberRestrictions).mockResolvedValue(
      access,
    );

    const result = await useWorkspaceSharingStore
      .getState()
      .updateMemberRestrictions("tree-1", "user-2", ["no-photos"]);

    expect(WorkspaceSharingService.updateMemberRestrictions).toHaveBeenCalledWith(
      "tree-1",
      "user-2",
      ["no-photos"],
    );
    expect(result).toBe(access);
  });

  it("transferOwnership forwards to WorkspaceSharingService.transferOwnership", async () => {
    const transfer: WorkspaceTransferResult = {
      access: [],
      undo_available_until: null,
    };
    vi.mocked(WorkspaceSharingService.transferOwnership).mockResolvedValue(
      transfer,
    );

    const result = await useWorkspaceSharingStore
      .getState()
      .transferOwnership("tree-1", "bob", "editor");

    expect(WorkspaceSharingService.transferOwnership).toHaveBeenCalledWith(
      "tree-1",
      "bob",
      "editor",
    );
    expect(result).toBe(transfer);
  });

  it("revertTransfer forwards to WorkspaceSharingService.revertTransfer", async () => {
    const transfer: WorkspaceTransferResult = {
      access: [],
      undo_available_until: null,
    };
    vi.mocked(WorkspaceSharingService.revertTransfer).mockResolvedValue(transfer);

    const result = await useWorkspaceSharingStore.getState().revertTransfer("tree-1");

    expect(WorkspaceSharingService.revertTransfer).toHaveBeenCalledWith("tree-1");
    expect(result).toBe(transfer);
  });

  it("createInvitation forwards to WorkspaceSharingService.createInvitation", async () => {
    const invitation: WorkspaceInvitation = {
      id: "inv-1",
      workspace_id: "tree-1",
      role: "editor",
      email: null,
      token: "tok",
      expires_at: null,
      created_at: "2026-01-01T00:00:00Z",
      accepted_at: null,
      revoked_at: null,
      status: "pending",
    };
    vi.mocked(WorkspaceSharingService.createInvitation).mockResolvedValue(
      invitation,
    );

    const result = await useWorkspaceSharingStore
      .getState()
      .createInvitation("tree-1", { role: "editor" });

    expect(WorkspaceSharingService.createInvitation).toHaveBeenCalledWith(
      "tree-1",
      { role: "editor" },
    );
    expect(result).toBe(invitation);
  });

  it("revokeInvitation forwards to WorkspaceSharingService.revokeInvitation", async () => {
    vi.mocked(WorkspaceSharingService.revokeInvitation).mockResolvedValue(
      undefined,
    );

    await useWorkspaceSharingStore.getState().revokeInvitation("tree-1", "inv-1");

    expect(WorkspaceSharingService.revokeInvitation).toHaveBeenCalledWith(
      "tree-1",
      "inv-1",
    );
  });

  it("setPublicAccess forwards to WorkspaceSharingService.setPublicAccess", async () => {
    const tree = { id: "tree-1", name: "Workspace", role: "owner" } as Workspace;
    vi.mocked(WorkspaceSharingService.setPublicAccess).mockResolvedValue(tree);

    const result = await useWorkspaceSharingStore
      .getState()
      .setPublicAccess("tree-1", "viewer");

    expect(WorkspaceSharingService.setPublicAccess).toHaveBeenCalledWith(
      "tree-1",
      "viewer",
    );
    expect(result).toBe(tree);
  });

  it("setPublicPassword forwards to WorkspaceSharingService.setPublicPassword", async () => {
    const tree = { id: "tree-1", name: "Workspace", role: "owner" } as Workspace;
    vi.mocked(WorkspaceSharingService.setPublicPassword).mockResolvedValue(tree);

    const result = await useWorkspaceSharingStore
      .getState()
      .setPublicPassword("tree-1", "secret123");

    expect(WorkspaceSharingService.setPublicPassword).toHaveBeenCalledWith(
      "tree-1",
      "secret123",
    );
    expect(result).toBe(tree);
  });

  it("grantAccessBatch forwards to WorkspaceSharingService.grantAccessBatch", async () => {
    const access: WorkspaceAccess[] = [];
    vi.mocked(WorkspaceSharingService.grantAccessBatch).mockResolvedValue(access);

    const result = await useWorkspaceSharingStore
      .getState()
      .grantAccessBatch("tree-1", "bob", "editor", ["tree-1", "tree-2"]);

    expect(WorkspaceSharingService.grantAccessBatch).toHaveBeenCalledWith(
      "tree-1",
      "bob",
      "editor",
      ["tree-1", "tree-2"],
    );
    expect(result).toBe(access);
  });

  it("revokeAccessBatch forwards to WorkspaceSharingService.revokeAccessBatch", async () => {
    vi.mocked(WorkspaceSharingService.revokeAccessBatch).mockResolvedValue(
      undefined,
    );

    await useWorkspaceSharingStore
      .getState()
      .revokeAccessBatch("tree-1", "user-2", ["tree-1", "tree-2"]);

    expect(WorkspaceSharingService.revokeAccessBatch).toHaveBeenCalledWith(
      "tree-1",
      "user-2",
      ["tree-1", "tree-2"],
    );
  });
});
