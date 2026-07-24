import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/TreeSharingService", () => ({
  TreeSharingService: {
    getSharingData: vi.fn(),
    getLinkedShareTrees: vi.fn(),
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

import { TreeSharingService } from "@/services/TreeSharingService";
import type { Tree, TreeAccess, TreeInvitation, TreeTransferResult } from "@/types/tree";
import { useTreeSharingStore } from "./useTreeSharingStore";

describe("useTreeSharingStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTreeSharingStore.setState({
      treeId: null,
      access: [],
      candidates: [],
      invitations: [],
      linkedTrees: [],
      loading: false,
      error: null,
    });
  });

  it("does not apply a stale sharing response after changing trees", async () => {
    let resolveFirst: (value: { access: []; candidates: [] }) => void = () =>
      undefined;
    vi.mocked(TreeSharingService.getSharingData)
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

    const first = useTreeSharingStore.getState().load("tree-1", {
      includeInvitations: false,
      includeLinkedTrees: false,
    });
    await useTreeSharingStore.getState().load("tree-2", {
      includeInvitations: false,
      includeLinkedTrees: false,
    });
    resolveFirst({ access: [], candidates: [] });
    await first;

    expect(useTreeSharingStore.getState()).toMatchObject({
      treeId: "tree-2",
      access: [expect.objectContaining({ username: "new-tree-user" })],
    });
  });

  it("clears the previous tree's sharing data while loading another tree", async () => {
    let resolveLoad: (value: { access: []; candidates: [] }) => void = () =>
      undefined;
    useTreeSharingStore.setState({
      treeId: "tree-1",
      access: [
        {
          user_id: "user-1",
          username: "previous-tree-user",
          role: "editor",
          restrictions: [],
        },
      ],
    });
    vi.mocked(TreeSharingService.getSharingData).mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const loading = useTreeSharingStore.getState().load("tree-2", {
      includeInvitations: false,
      includeLinkedTrees: false,
    });

    expect(useTreeSharingStore.getState().access).toEqual([]);
    resolveLoad({ access: [], candidates: [] });
    await loading;
  });
});

// Every action below is a thin `run(treeId, () => TreeSharingService.x(...))`
// wrapper — these tests confirm each one forwards its args to the right
// service method and resolves with its return value. Component tests
// (ShareTreeDialog.test.tsx) mock this store directly rather than
// TreeSharingService, so this is the only place these wrappers are covered.
describe("useTreeSharingStore — action wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grantAccess forwards to TreeSharingService.grantAccess", async () => {
    const access: TreeAccess[] = [
      { user_id: "user-2", username: "bob", role: "editor", restrictions: [] },
    ];
    vi.mocked(TreeSharingService.grantAccess).mockResolvedValue(access);

    const result = await useTreeSharingStore
      .getState()
      .grantAccess("tree-1", "bob", "editor");

    expect(TreeSharingService.grantAccess).toHaveBeenCalledWith(
      "tree-1",
      "bob",
      "editor",
    );
    expect(result).toBe(access);
  });

  it("revokeAccess forwards to TreeSharingService.revokeAccess", async () => {
    vi.mocked(TreeSharingService.revokeAccess).mockResolvedValue(undefined);

    await useTreeSharingStore.getState().revokeAccess("tree-1", "user-2");

    expect(TreeSharingService.revokeAccess).toHaveBeenCalledWith(
      "tree-1",
      "user-2",
    );
  });

  it("updateMemberRestrictions forwards to TreeSharingService.updateMemberRestrictions", async () => {
    const access: TreeAccess[] = [];
    vi.mocked(TreeSharingService.updateMemberRestrictions).mockResolvedValue(
      access,
    );

    const result = await useTreeSharingStore
      .getState()
      .updateMemberRestrictions("tree-1", "user-2", ["no-photos"]);

    expect(TreeSharingService.updateMemberRestrictions).toHaveBeenCalledWith(
      "tree-1",
      "user-2",
      ["no-photos"],
    );
    expect(result).toBe(access);
  });

  it("transferOwnership forwards to TreeSharingService.transferOwnership", async () => {
    const transfer: TreeTransferResult = {
      access: [],
      undo_available_until: null,
    };
    vi.mocked(TreeSharingService.transferOwnership).mockResolvedValue(
      transfer,
    );

    const result = await useTreeSharingStore
      .getState()
      .transferOwnership("tree-1", "bob", "editor");

    expect(TreeSharingService.transferOwnership).toHaveBeenCalledWith(
      "tree-1",
      "bob",
      "editor",
    );
    expect(result).toBe(transfer);
  });

  it("revertTransfer forwards to TreeSharingService.revertTransfer", async () => {
    const transfer: TreeTransferResult = {
      access: [],
      undo_available_until: null,
    };
    vi.mocked(TreeSharingService.revertTransfer).mockResolvedValue(transfer);

    const result = await useTreeSharingStore.getState().revertTransfer("tree-1");

    expect(TreeSharingService.revertTransfer).toHaveBeenCalledWith("tree-1");
    expect(result).toBe(transfer);
  });

  it("createInvitation forwards to TreeSharingService.createInvitation", async () => {
    const invitation: TreeInvitation = {
      id: "inv-1",
      tree_id: "tree-1",
      role: "editor",
      email: null,
      token: "tok",
      expires_at: null,
      created_at: "2026-01-01T00:00:00Z",
      accepted_at: null,
      revoked_at: null,
      status: "pending",
    };
    vi.mocked(TreeSharingService.createInvitation).mockResolvedValue(
      invitation,
    );

    const result = await useTreeSharingStore
      .getState()
      .createInvitation("tree-1", { role: "editor" });

    expect(TreeSharingService.createInvitation).toHaveBeenCalledWith(
      "tree-1",
      { role: "editor" },
    );
    expect(result).toBe(invitation);
  });

  it("revokeInvitation forwards to TreeSharingService.revokeInvitation", async () => {
    vi.mocked(TreeSharingService.revokeInvitation).mockResolvedValue(
      undefined,
    );

    await useTreeSharingStore.getState().revokeInvitation("tree-1", "inv-1");

    expect(TreeSharingService.revokeInvitation).toHaveBeenCalledWith(
      "tree-1",
      "inv-1",
    );
  });

  it("setPublicAccess forwards to TreeSharingService.setPublicAccess", async () => {
    const tree = { id: "tree-1", name: "Tree", role: "owner" } as Tree;
    vi.mocked(TreeSharingService.setPublicAccess).mockResolvedValue(tree);

    const result = await useTreeSharingStore
      .getState()
      .setPublicAccess("tree-1", "viewer");

    expect(TreeSharingService.setPublicAccess).toHaveBeenCalledWith(
      "tree-1",
      "viewer",
    );
    expect(result).toBe(tree);
  });

  it("setPublicPassword forwards to TreeSharingService.setPublicPassword", async () => {
    const tree = { id: "tree-1", name: "Tree", role: "owner" } as Tree;
    vi.mocked(TreeSharingService.setPublicPassword).mockResolvedValue(tree);

    const result = await useTreeSharingStore
      .getState()
      .setPublicPassword("tree-1", "secret123");

    expect(TreeSharingService.setPublicPassword).toHaveBeenCalledWith(
      "tree-1",
      "secret123",
    );
    expect(result).toBe(tree);
  });

  it("getLinkedShareTrees forwards to TreeSharingService.getLinkedShareTrees", async () => {
    vi.mocked(TreeSharingService.getLinkedShareTrees).mockResolvedValue([]);

    const result = await useTreeSharingStore
      .getState()
      .getLinkedShareTrees("tree-1", "bob");

    expect(TreeSharingService.getLinkedShareTrees).toHaveBeenCalledWith(
      "tree-1",
      "bob",
    );
    expect(result).toEqual([]);
  });

  it("grantAccessBatch forwards to TreeSharingService.grantAccessBatch", async () => {
    const access: TreeAccess[] = [];
    vi.mocked(TreeSharingService.grantAccessBatch).mockResolvedValue(access);

    const result = await useTreeSharingStore
      .getState()
      .grantAccessBatch("tree-1", "bob", "editor", ["tree-1", "tree-2"]);

    expect(TreeSharingService.grantAccessBatch).toHaveBeenCalledWith(
      "tree-1",
      "bob",
      "editor",
      ["tree-1", "tree-2"],
    );
    expect(result).toBe(access);
  });

  it("revokeAccessBatch forwards to TreeSharingService.revokeAccessBatch", async () => {
    vi.mocked(TreeSharingService.revokeAccessBatch).mockResolvedValue(
      undefined,
    );

    await useTreeSharingStore
      .getState()
      .revokeAccessBatch("tree-1", "user-2", ["tree-1", "tree-2"]);

    expect(TreeSharingService.revokeAccessBatch).toHaveBeenCalledWith(
      "tree-1",
      "user-2",
      ["tree-1", "tree-2"],
    );
  });
});
