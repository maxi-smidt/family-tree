import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/TreeSharingService", () => ({
  TreeSharingService: {
    getSharingData: vi.fn(),
    getLinkedShareTrees: vi.fn(),
    listInvitations: vi.fn(),
  },
}));

import { TreeSharingService } from "@/services/TreeSharingService";
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
