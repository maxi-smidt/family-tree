/**
 * Integration tests for useTreeStore covering:
 *   - Tree switching (connect / selectTree)
 *   - Disconnect behavior (all sub-stores cleared)
 *   - Role / permission workflow (owner vs editor vs viewer)
 *   - loadTrees drops a vanished selection and auto-selects the next tree
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTreeStoreForSession, useTreeStore } from "./useTreeStore";
import { useMemberStore } from "./useMemberStore";
import { useEventStore } from "./useEventStore";
import { useStoryStore } from "./useStoryStore";
import { useDocumentStore } from "./useDocumentStore";
import { useGalleryStore } from "./useGalleryStore";
import { useActivityStore } from "./useActivityStore";
import { useStatisticsStore } from "./useStatisticsStore";
import { useQualityReportStore } from "./useQualityReportStore";
import { useStorageStore } from "./useStorageStore";
import { useMemberSheetStore } from "./useMemberSheetStore";
import { ApiError, api } from "@/services/api";
import { TreeService } from "@/services/TreeService";
import { Tree } from "@/types/tree";

vi.mock("@/services/api", async (importOriginal) => {
  // Keep the real ApiError/setPublicTreeToken exports — useTreeStore does an
  // `instanceof ApiError` check, which needs the real class, not a mock stub.
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    },
    getAuthToken: vi.fn(() => null),
    setAuthToken: vi.fn(),
    onUnauthorized: vi.fn(),
  };
});
vi.mock("@/services/TreeService");

const TREE_A: Tree = { id: "tree-a", name: "Tree A", role: "owner" };
const TREE_B: Tree = { id: "tree-b", name: "Tree B", role: "editor" };
const TREE_VIEWER: Tree = { id: "tree-v", name: "Tree V", role: "viewer" };

function mockEmptySubStores() {
  vi.mocked(TreeService.getMembers).mockResolvedValue([]);
  vi.mocked(TreeService.getRelations).mockResolvedValue([]);
  vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
  vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
  vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);
  vi.mocked(TreeService.getGalleryUnknownFaces).mockResolvedValue([]);
  vi.mocked(TreeService.getEvents).mockResolvedValue([]);
  vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);
  vi.mocked(TreeService.getStories).mockResolvedValue([]);
  vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([]);
  vi.mocked(TreeService.getDocuments).mockResolvedValue([]);
  vi.mocked(TreeService.getActivity).mockResolvedValue({
    entries: [],
    total: 0,
    actors: [],
  });
  vi.mocked(TreeService.getRelationTypes).mockResolvedValue([]);
  vi.mocked(TreeService.listVirtualViews).mockResolvedValue([]);
}

/** Set up api.get to return `treeResponse` for the given tree id and {} for metadata. */
function mockApiGetForConnect(treeId: string, treeResponse: Tree) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === `/trees/${treeId}`) return Promise.resolve(treeResponse);
    if (path.includes("/metadata")) return Promise.resolve({});
    return Promise.resolve([]);
  });
}

function seedMemberStore() {
  useMemberStore.setState({ members: [{ id: "m-stale" } as never] });
}
function seedEventStore() {
  useEventStore.setState({ events: [{ id: "e-stale" } as never] });
}
function seedStoryStore() {
  useStoryStore.setState({ stories: [{ id: "s-stale" } as never] });
}
function seedGalleryStore() {
  useGalleryStore.setState({ galleryImages: [{ id: "g-stale" } as never] });
}
function seedActivityStore() {
  useActivityStore.setState({ activities: [{ id: "a-stale" } as never] });
}

const INITIAL_TREE_STATE = {
  trees: [],
  virtualViews: [],
  selectedTree: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useTreeStore.setState(INITIAL_TREE_STATE);
  useMemberStore.setState({ members: [], undoStack: [], redoStack: [] });
  useEventStore.setState({ events: [] });
  useStoryStore.setState({ stories: [] });
  useDocumentStore.setState({ documents: [] });
  useGalleryStore.setState({ galleryImages: [] });
  useActivityStore.setState({ activities: [] });
  useStatisticsStore.setState({ report: null, scope: "tree" });
  useQualityReportStore.setState({ report: null, showDismissed: false });
  useStorageStore.setState({ usage: null, error: false });
  useMemberSheetStore.setState({ openSheets: {} });
});

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe("useTreeStore — disconnect", () => {
  it("clears selectedTree and isReady", async () => {
    useTreeStore.setState({ selectedTree: TREE_A, isReady: true });

    await useTreeStore.getState().disconnect();

    const { selectedTree, isReady } = useTreeStore.getState();
    expect(selectedTree).toBeUndefined();
    expect(isReady).toBe(false);
  });

  it("clears all sub-stores on disconnect using explicit clear()", async () => {
    useTreeStore.setState({ selectedTree: TREE_A, isReady: true });
    seedMemberStore();
    seedEventStore();
    seedStoryStore();
    seedGalleryStore();
    seedActivityStore();

    // disconnect() now calls each store's explicit clear() action synchronously —
    // no HTTP calls needed and no reliance on refreshX seeing no active tree.
    await useTreeStore.getState().disconnect();

    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(useStoryStore.getState().stories).toHaveLength(0);
    expect(useGalleryStore.getState().galleryImages).toHaveLength(0);
    expect(useActivityStore.getState().activities).toHaveLength(0);
  });
});

describe("useTreeStore — session reset", () => {
  it("clears tree lists, selection, and loaded tree data", () => {
    useTreeStore.setState({
      trees: [TREE_A],
      virtualViews: [TREE_VIEWER],
      selectedTree: TREE_A,
      metadata: { id: TREE_A.id, name: TREE_A.name },
      relationTypes: [
        {
          id: "parent",
          description: "Parent",
          label: null,
          color: null,
          stroke_width: null,
          stroke_dasharray: null,
        },
      ],
      isReady: true,
    });
    seedMemberStore();
    seedEventStore();
    seedStoryStore();
    seedGalleryStore();
    seedActivityStore();

    resetTreeStoreForSession();

    expect(useTreeStore.getState()).toMatchObject({
      trees: [],
      virtualViews: [],
      selectedTree: undefined,
      metadata: {},
      relationTypes: [],
      isReady: false,
    });
    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(useStoryStore.getState().stories).toHaveLength(0);
    expect(useGalleryStore.getState().galleryImages).toHaveLength(0);
    expect(useActivityStore.getState().activities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// connect / selectTree
// ---------------------------------------------------------------------------

describe("useTreeStore — connect / selectTree", () => {
  it("sets selectedTree and marks isReady after connecting", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await useTreeStore.getState().connect(TREE_A);

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });

  it("selectTree(undefined) disconnects", async () => {
    useTreeStore.setState({ selectedTree: TREE_A, isReady: true });

    await useTreeStore.getState().selectTree(undefined);

    expect(useTreeStore.getState().selectedTree).toBeUndefined();
    expect(useTreeStore.getState().isReady).toBe(false);
  });

  it("switching trees loads data for the new tree", async () => {
    // Connect tree A
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);
    await useTreeStore.getState().connect(TREE_A);
    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);

    // Switch to tree B
    mockApiGetForConnect(TREE_B.id, TREE_B);
    await useTreeStore.getState().selectTree(TREE_B);

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_B.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });

  it("resolves a tree id through the store before selecting it", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await expect(
      useTreeStore.getState().openTreeById(TREE_A.id),
    ).resolves.toEqual(TREE_A);

    expect(api.get).toHaveBeenCalledWith(`/trees/${TREE_A.id}`);
    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);
  });

  it("inserts the tree into the list when reopening one that's missing from it", async () => {
    // Mirrors clicking a "shared with you" notification for a tree that
    // loadTrees() had already dropped (e.g. from a prior connect failure) —
    // connect() succeeds and must add it back, not just try to update an
    // entry that isn't there. Otherwise the tree selector (which renders
    // only from `trees`) shows no selection at all even though the store is
    // genuinely connected.
    mockEmptySubStores();
    useTreeStore.setState({ trees: [TREE_B] });
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await useTreeStore.getState().openTreeById(TREE_A.id);

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useTreeStore.getState().trees.map((t) => t.id)).toEqual([
      TREE_A.id,
      TREE_B.id,
    ]);
  });

  it("opens an outside-tree result, queues its locate, and opens its details", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_B.id, TREE_B);

    await useTreeStore
      .getState()
      .openTreeAndLocateMember(TREE_B.id, "member-b");

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_B.id);
    expect(useMemberStore.getState().pendingLocateMemberId).toBe("member-b");
    expect(useMemberSheetStore.getState().openSheets[TREE_B.id]).toEqual({
      memberId: "member-b",
      tab: "identity",
      mode: "view",
    });
  });

  it("disconnects cleanly and rejects when access was revoked (403)", async () => {
    mockEmptySubStores();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${TREE_A.id}`) {
        return Promise.reject(new ApiError(403, "Forbidden"));
      }
      if (path === "/trees") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await expect(useTreeStore.getState().connect(TREE_A)).rejects.toThrow();

    // Must not be left half-connected to a tree it can't actually read —
    // a stale selectedTree here is what made the DB selector show a blank
    // entry and the canvas look like an empty "new" tree (#807 follow-up).
    expect(useTreeStore.getState().selectedTree).toBeUndefined();
    expect(useTreeStore.getState().isReady).toBe(false);
  });

  it("still rejects when a concurrent disconnect wins the race before a 403 (#813)", async () => {
    mockEmptySubStores();
    // An SSE-triggered loadTrees() disconnects while connect's GET is in
    // flight; the 403 then arrives with the tree no longer active. The
    // caller (e.g. the notification bell) must still see a rejection so its
    // toast + recovery run — resolving silently strands the user (#813).
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === `/trees/${TREE_A.id}`) {
        await useTreeStore.getState().disconnect();
        throw new ApiError(403, "Forbidden");
      }
      if (path === "/trees") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await expect(useTreeStore.getState().connect(TREE_A)).rejects.toThrow();

    // The concurrent disconnect is not undone — no stale tree is restored.
    expect(useTreeStore.getState().selectedTree).toBeUndefined();
    expect(useTreeStore.getState().isReady).toBe(false);
  });

  it("lands on the remaining tree instead of a blank canvas after a 403 (#813)", async () => {
    mockEmptySubStores();
    useTreeStore.setState({ trees: [TREE_A, TREE_B] });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${TREE_A.id}`) {
        return Promise.reject(new ApiError(403, "Forbidden"));
      }
      if (path === "/trees") return Promise.resolve([TREE_B]);
      if (path === `/trees/${TREE_B.id}`) return Promise.resolve(TREE_B);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await expect(useTreeStore.getState().connect(TREE_A)).rejects.toThrow();

    // The stale tree is never restored — the caller (e.g. the notification
    // bell) still gets its rejection to show a toast against. But
    // disconnect()'s own loadTrees() no longer sees the stale selection to
    // react to, so connect() must refresh the list and land on the fallback
    // itself, settling on the one remaining tree instead of leaving the
    // canvas blank.
    await vi.waitFor(() => {
      expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_B.id);
      expect(useTreeStore.getState().isReady).toBe(true);
    });
  });

  it("selectTree also rejects and disconnects when the target 404s", async () => {
    mockEmptySubStores();
    useTreeStore.setState({ selectedTree: TREE_B, isReady: true });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${TREE_A.id}`) {
        return Promise.reject(new ApiError(404, "Not Found"));
      }
      return Promise.resolve([]);
    });

    await expect(useTreeStore.getState().selectTree(TREE_A)).rejects.toThrow();

    expect(useTreeStore.getState().selectedTree).toBeUndefined();
  });

  it("tolerates a transient (non-access) failure and proceeds with what it has", async () => {
    mockEmptySubStores();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${TREE_A.id}`)
        return Promise.reject(new Error("network error"));
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await useTreeStore.getState().connect(TREE_A);

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });

  it("does not select a slower tree-link response after a newer request", async () => {
    mockEmptySubStores();
    let resolveTreeA: (tree: Tree) => void = () => undefined;
    const treeAResponse = new Promise<Tree>((resolve) => {
      resolveTreeA = resolve;
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${TREE_A.id}`) return treeAResponse;
      if (path === `/trees/${TREE_B.id}`) return Promise.resolve(TREE_B);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    const slowOpen = useTreeStore.getState().openTreeById(TREE_A.id);
    await useTreeStore.getState().openTreeById(TREE_B.id);
    resolveTreeA(TREE_A);
    await slowOpen;

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_B.id);
  });

  it("continues a public tree link started during session reset", async () => {
    mockEmptySubStores();
    let resolveTree: (tree: Tree) => void = () => undefined;
    const treeResponse = new Promise<Tree>((resolve) => {
      resolveTree = resolve;
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${TREE_A.id}`) return treeResponse;
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    const opening = useTreeStore.getState().openTreeById(TREE_A.id);
    resetTreeStoreForSession();
    resolveTree(TREE_A);
    await opening;

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });

  it("invalidates every content store when switching trees", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_B.id, TREE_B);
    useTreeStore.setState({ selectedTree: TREE_A, isReady: true });
    useMemberStore.setState({ members: [{ id: "m-stale" } as never] });
    useGalleryStore.setState({
      galleryImages: [{ id: "g-stale" } as never],
      initialized: true,
    });
    useEventStore.setState({
      events: [{ id: "e-stale" } as never],
      initialized: true,
    });
    useStoryStore.setState({
      stories: [{ id: "s-stale" } as never],
      initialized: true,
    });
    useDocumentStore.setState({
      documents: [{ id: "d-stale" } as never],
      initialized: true,
    });
    useActivityStore.setState({
      activities: [{ id: "a-stale" } as never],
      initialized: true,
    });
    useStatisticsStore.setState({ report: {} as never, scope: "linked" });
    useQualityReportStore.setState({
      report: {} as never,
      showDismissed: true,
    });
    useStorageStore.setState({ usage: {} as never, error: true });

    await useTreeStore.getState().selectTree(TREE_B);

    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(useGalleryStore.getState()).toMatchObject({
      galleryImages: [],
      initialized: false,
    });
    expect(useEventStore.getState()).toMatchObject({
      events: [],
      initialized: false,
    });
    expect(useStoryStore.getState()).toMatchObject({
      stories: [],
      initialized: false,
    });
    expect(useDocumentStore.getState()).toMatchObject({
      documents: [],
      initialized: false,
    });
    expect(useActivityStore.getState()).toMatchObject({
      activities: [],
      initialized: false,
    });
    expect(useStatisticsStore.getState()).toMatchObject({
      report: null,
      scope: "tree",
    });
    expect(useQualityReportStore.getState()).toMatchObject({
      report: null,
      showDismissed: false,
    });
    expect(useStorageStore.getState()).toMatchObject({
      usage: null,
      error: false,
    });
  });

  it("defers secondary store loads until first tab visit (connect only loads members)", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await useTreeStore.getState().connect(TREE_A);

    expect(useTreeStore.getState().isReady).toBe(true);
    // Secondary stores are deferred to first tab visit — connect() does NOT load them.
    expect(TreeService.getGalleryImages).not.toHaveBeenCalled();
    expect(TreeService.getEvents).not.toHaveBeenCalled();
    expect(TreeService.getStories).not.toHaveBeenCalled();
    expect(TreeService.getActivity).not.toHaveBeenCalled();
    // Core stores are still loaded eagerly.
    expect(TreeService.getMembers).toHaveBeenCalled();
    expect(TreeService.getRelationTypes).toHaveBeenCalled();
  });

  it("secondary stores remain deferred on connect", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await useTreeStore.getState().connect(TREE_A);

    expect(useTreeStore.getState().isReady).toBe(true);
    // No secondary stores loaded on connect (deferred to first tab visit).
    expect(TreeService.getGalleryImages).not.toHaveBeenCalled();
    expect(TreeService.getEvents).not.toHaveBeenCalled();
    expect(TreeService.getStories).not.toHaveBeenCalled();
    expect(TreeService.getActivity).not.toHaveBeenCalled();
  });

  it("virtual tree connect still defers secondary stores", async () => {
    const VV: Tree = {
      id: "vv_x",
      name: "Composite",
      role: "viewer",
      is_virtual: true,
    };
    mockEmptySubStores();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/virtual-views/${VV.id}`) return Promise.resolve(VV);
      // hasLayout: true so connect() respects the saved overlay (no auto-layout).
      if (path.includes("/metadata"))
        return Promise.resolve({ hasLayout: true });
      return Promise.resolve([]);
    });

    await useTreeStore.getState().connect(VV);

    expect(useTreeStore.getState().selectedTree?.id).toBe(VV.id);
    expect(useTreeStore.getState().isReady).toBe(true);
    // Secondary stores are deferred even for virtual trees.
    expect(TreeService.getGalleryImages).not.toHaveBeenCalled();
    expect(TreeService.getEvents).not.toHaveBeenCalled();
    expect(TreeService.getStories).not.toHaveBeenCalled();
    expect(TreeService.getActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// role / permission workflow
// ---------------------------------------------------------------------------

describe("useTreeStore — role & permissions", () => {
  it("stores the role returned by the server after connect", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_VIEWER.id, { ...TREE_VIEWER });

    await useTreeStore.getState().connect(TREE_VIEWER);

    expect(useTreeStore.getState().selectedTree?.role).toBe("viewer");
  });

  it("stores owner role when server returns owner", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, { ...TREE_A, role: "owner" });

    await useTreeStore.getState().connect(TREE_A);

    expect(useTreeStore.getState().selectedTree?.role).toBe("owner");
  });

  it("stores editor role when server returns editor", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_B.id, { ...TREE_B, role: "editor" });

    await useTreeStore.getState().connect(TREE_B);

    expect(useTreeStore.getState().selectedTree?.role).toBe("editor");
  });

  it("falls back to the original tree role if the GET /trees/:id fails", async () => {
    mockEmptySubStores();
    // connect() catches errors from the GET and continues with local state
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${TREE_A.id}`)
        return Promise.reject(new Error("403"));
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await useTreeStore.getState().connect(TREE_A);

    // Should not throw; selectedTree stays as-is (no crash)
    expect(useTreeStore.getState().isReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadTrees — auto-disconnect when selected tree vanishes
// ---------------------------------------------------------------------------

describe("useTreeStore — loadTrees", () => {
  it("auto-selects the most recent remaining tree when the active one disappears", async () => {
    mockEmptySubStores();
    useTreeStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      trees: [TREE_A],
    });

    // Server returns a list that no longer includes tree-a
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === "/trees") return Promise.resolve([TREE_B]);
      if (path === `/trees/${TREE_B.id}`) return Promise.resolve(TREE_B);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });
    vi.mocked(TreeService.listVirtualViews).mockResolvedValue([]);

    await useTreeStore.getState().loadTrees();

    // Lands on the remaining tree (startup's MRU rule) instead of a blank
    // canvas with no selection (#813/#814).
    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_B.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });

  it("auto-disconnects when the active tree is gone and none remain", async () => {
    useTreeStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      trees: [TREE_A],
    });

    vi.mocked(api.get).mockResolvedValueOnce([]);
    vi.mocked(TreeService.listVirtualViews).mockResolvedValueOnce([]);

    await useTreeStore.getState().loadTrees();

    expect(useTreeStore.getState().selectedTree).toBeUndefined();
    expect(useTreeStore.getState().isReady).toBe(false);
  });

  it("keeps the selected tree when it is still in the returned list", async () => {
    useTreeStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      trees: [TREE_A],
    });

    vi.mocked(api.get).mockResolvedValueOnce([TREE_A, TREE_B]);
    vi.mocked(TreeService.listVirtualViews).mockResolvedValueOnce([]);

    await useTreeStore.getState().loadTrees();

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });

  it("refreshes the selected tree role from the returned list", async () => {
    const retainedTree: Tree = {
      ...TREE_A,
      role: "viewer",
      restrictions: ["gallery"],
    };
    useTreeStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      trees: [TREE_A],
    });

    vi.mocked(api.get).mockResolvedValueOnce([retainedTree, TREE_B]);
    vi.mocked(TreeService.listVirtualViews).mockResolvedValueOnce([]);

    await useTreeStore.getState().loadTrees();

    expect(useTreeStore.getState().selectedTree).toEqual(retainedTree);
    expect(useTreeStore.getState().selectedTree?.role).toBe("viewer");
    expect(useTreeStore.getState().isReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createTree
// ---------------------------------------------------------------------------

describe("useTreeStore — createTree", () => {
  it("calls api.post and auto-selects the new tree", async () => {
    const newTree: Tree = { id: "new-t", name: "New Tree", role: "owner" };
    vi.mocked(api.post).mockResolvedValueOnce(newTree);
    mockEmptySubStores();
    // selectTree → connect will call api.get for the new tree
    mockApiGetForConnect(newTree.id, newTree);

    const result = await useTreeStore.getState().createTree("New Tree");

    expect(api.post).toHaveBeenCalledWith(
      "/trees",
      expect.objectContaining({ name: "New Tree" }),
    );
    expect(result.id).toBe("new-t");
    expect(useTreeStore.getState().selectedTree?.id).toBe("new-t");
  });
});

// ---------------------------------------------------------------------------
// deleteTree
// ---------------------------------------------------------------------------

describe("useTreeStore — deleteTree", () => {
  it("removes the tree from the list and disconnects if it was selected", async () => {
    useTreeStore.setState({
      trees: [TREE_A, TREE_B],
      selectedTree: TREE_A,
      isReady: true,
    });
    vi.mocked(api.del).mockResolvedValueOnce(undefined);

    await useTreeStore.getState().deleteTree(TREE_A);

    const { trees, selectedTree } = useTreeStore.getState();
    expect(trees.some((t) => t.id === TREE_A.id)).toBe(false);
    expect(selectedTree).toBeUndefined();
  });

  it("does not disconnect when a non-active tree is deleted", async () => {
    useTreeStore.setState({
      trees: [TREE_A, TREE_B],
      selectedTree: TREE_A,
      isReady: true,
    });
    vi.mocked(api.del).mockResolvedValueOnce(undefined);

    await useTreeStore.getState().deleteTree(TREE_B);

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stale-write guard / fast switching
// ---------------------------------------------------------------------------

describe("useTreeStore — stale-write guard / fast switching", () => {
  it("disconnect clears member undo/redo history", async () => {
    useTreeStore.setState({ selectedTree: TREE_A, isReady: true });
    useMemberStore.setState({
      undoStack: [{ undo: async () => {}, redo: async () => {} }],
      redoStack: [{ undo: async () => {}, redo: async () => {} }],
    });

    await useTreeStore.getState().disconnect();

    expect(useMemberStore.getState().undoStack).toHaveLength(0);
    expect(useMemberStore.getState().redoStack).toHaveLength(0);
  });

  it("connect(B) after connect(A) ends with B selected and B's data", async () => {
    // Connect tree A
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);
    await useTreeStore.getState().connect(TREE_A);
    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_A.id);

    // Immediately connect tree B (fast switch)
    mockApiGetForConnect(TREE_B.id, TREE_B);
    await useTreeStore.getState().connect(TREE_B);

    expect(useTreeStore.getState().selectedTree?.id).toBe(TREE_B.id);
    expect(useTreeStore.getState().isReady).toBe(true);
  });

  it("deferred refreshMembers for tree-A is dropped when tree-B is active", async () => {
    // Set up a deferred members fetch for TREE_A
    let resolveA!: (v: never[]) => void;
    const pendingA = new Promise<never[]>((r) => {
      resolveA = r;
    });
    vi.mocked(TreeService.getMembers).mockReturnValue(pendingA);
    vi.mocked(TreeService.getRelations).mockResolvedValue([]);
    vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryUnknownFaces).mockResolvedValue([]);
    vi.mocked(TreeService.getEvents).mockResolvedValue([]);
    vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);
    vi.mocked(TreeService.getStories).mockResolvedValue([]);
    vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([]);
    vi.mocked(TreeService.getActivity).mockResolvedValue({
      entries: [],
      total: 0,
      actors: [],
    });
    vi.mocked(TreeService.getRelationTypes).mockResolvedValue([]);
    mockApiGetForConnect(TREE_A.id, TREE_A);

    // Start connecting A (members fetch is deferred)
    const connectAPromise = useTreeStore.getState().connect(TREE_A);

    // Switch to B before A's member data arrives
    useTreeStore.setState({ selectedTree: TREE_B });

    // Resolve A's deferred fetch
    resolveA([]);
    await connectAPromise;

    // Members should still be empty — stale data dropped
    expect(useMemberStore.getState().members).toHaveLength(0);
  });
});
