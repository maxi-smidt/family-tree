/**
 * Integration tests for useWorkspaceStore covering:
 *   - Workspace switching (connect / selectTree)
 *   - Disconnect behavior (all sub-stores cleared)
 *   - Role / permission workflow (owner vs editor vs viewer)
 *   - loadTrees drops a vanished selection and auto-selects the next tree
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTreeStoreForSession, useWorkspaceStore } from "./useWorkspaceStore";
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
import { WorkspaceService } from "@/services/WorkspaceService";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/api", async (importOriginal) => {
  // Keep the real ApiError/setPublicTreeToken exports — useWorkspaceStore does an
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
vi.mock("@/services/WorkspaceService");

const TREE_A: Workspace = { id: "tree-a", name: "Workspace A", role: "owner" };
const TREE_B: Workspace = { id: "tree-b", name: "Workspace B", role: "editor" };
const TREE_VIEWER: Workspace = { id: "tree-v", name: "Workspace V", role: "viewer" };

function mockEmptySubStores() {
  vi.mocked(WorkspaceService.getMembers).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getGalleryUnknownFaces).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getActivity).mockResolvedValue({
    entries: [],
    total: 0,
    actors: [],
  });
  vi.mocked(WorkspaceService.getRelationTypes).mockResolvedValue([]);
  vi.mocked(WorkspaceService.listVirtualViews).mockResolvedValue([]);
}

/** Set up api.get to return `treeResponse` for the given tree id and {} for metadata. */
function mockApiGetForConnect(workspaceId: string, treeResponse: Workspace) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === `/workspaces/${workspaceId}`) return Promise.resolve(treeResponse);
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
  workspaces: [],
  virtualViews: [],
  selectedTree: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(INITIAL_TREE_STATE);
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

describe("useWorkspaceStore — disconnect", () => {
  it("clears selectedTree and isReady", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE_A, isReady: true });

    await useWorkspaceStore.getState().disconnect();

    const { selectedTree, isReady } = useWorkspaceStore.getState();
    expect(selectedTree).toBeUndefined();
    expect(isReady).toBe(false);
  });

  it("clears all sub-stores on disconnect using explicit clear()", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE_A, isReady: true });
    seedMemberStore();
    seedEventStore();
    seedStoryStore();
    seedGalleryStore();
    seedActivityStore();

    // disconnect() now calls each store's explicit clear() action synchronously —
    // no HTTP calls needed and no reliance on refreshX seeing no active tree.
    await useWorkspaceStore.getState().disconnect();

    expect(useMemberStore.getState().members).toHaveLength(0);
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(useStoryStore.getState().stories).toHaveLength(0);
    expect(useGalleryStore.getState().galleryImages).toHaveLength(0);
    expect(useActivityStore.getState().activities).toHaveLength(0);
  });
});

describe("useWorkspaceStore — session reset", () => {
  it("clears tree lists, selection, and loaded tree data", () => {
    useWorkspaceStore.setState({
      workspaces: [TREE_A],
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

    expect(useWorkspaceStore.getState()).toMatchObject({
      workspaces: [],
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

describe("useWorkspaceStore — connect / selectTree", () => {
  it("sets selectedTree and marks isReady after connecting", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await useWorkspaceStore.getState().connect(TREE_A);

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });

  it("selectTree(undefined) disconnects", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE_A, isReady: true });

    await useWorkspaceStore.getState().selectTree(undefined);

    expect(useWorkspaceStore.getState().selectedTree).toBeUndefined();
    expect(useWorkspaceStore.getState().isReady).toBe(false);
  });

  it("switching workspaces loads data for the new tree", async () => {
    // Connect tree A
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);
    await useWorkspaceStore.getState().connect(TREE_A);
    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);

    // Switch to tree B
    mockApiGetForConnect(TREE_B.id, TREE_B);
    await useWorkspaceStore.getState().selectTree(TREE_B);

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_B.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });

  it("resolves a tree id through the store before selecting it", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await expect(
      useWorkspaceStore.getState().openTreeById(TREE_A.id),
    ).resolves.toEqual(TREE_A);

    expect(api.get).toHaveBeenCalledWith(`/workspaces/${TREE_A.id}`);
    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
  });

  it("falls back to the migration-mapped id when the requested tree is a stale (404) v1 id", async () => {
    mockEmptySubStores();
    const oldId = "old-tree";
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${oldId}`) {
        return Promise.reject(new ApiError(404, "Not found"));
      }
      if (path === `/workspaces/${TREE_A.id}`) return Promise.resolve(TREE_A);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });
    vi.mocked(WorkspaceService.resolveLegacyWorkspaceId).mockResolvedValue(
      TREE_A.id,
    );

    const tree = await useWorkspaceStore.getState().openTreeById(oldId);

    expect(tree).toEqual(TREE_A);
    expect(WorkspaceService.resolveLegacyWorkspaceId).toHaveBeenCalledWith(
      oldId,
    );
    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
  });

  it("rethrows the original error when a missing tree has no migration mapping", async () => {
    mockEmptySubStores();
    const oldId = "never-migrated";
    const notFound = new ApiError(404, "Not found");
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${oldId}`) return Promise.reject(notFound);
      return Promise.resolve([]);
    });
    vi.mocked(WorkspaceService.resolveLegacyWorkspaceId).mockResolvedValue(
      null,
    );

    await expect(
      useWorkspaceStore.getState().openTreeById(oldId),
    ).rejects.toBe(notFound);
  });

  it("unlocks a password-protected tree under its migration-mapped id when the given id is stale (404)", async () => {
    mockEmptySubStores();
    const oldId = "old-tree";
    vi.mocked(api.post).mockImplementation((path: string) => {
      if (path === `/workspaces/${oldId}/public/unlock`) {
        return Promise.reject(new ApiError(404, "Not found"));
      }
      if (path === `/workspaces/${TREE_A.id}/public/unlock`) {
        return Promise.resolve({ token: "unlock-token" });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${TREE_A.id}`) return Promise.resolve(TREE_A);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });
    vi.mocked(WorkspaceService.resolveLegacyWorkspaceId).mockResolvedValue(
      TREE_A.id,
    );

    const tree = await useWorkspaceStore
      .getState()
      .unlockPublicTree(oldId, "secret");

    expect(tree).toEqual(TREE_A);
    expect(api.post).toHaveBeenCalledWith(
      `/workspaces/${oldId}/public/unlock`,
      { password: "secret" },
    );
    expect(api.post).toHaveBeenCalledWith(
      `/workspaces/${TREE_A.id}/public/unlock`,
      { password: "secret" },
    );
    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
  });

  it("surfaces a wrong-password 401 without attempting legacy-id resolution", async () => {
    const unauthorized = new ApiError(401, "invalid_public_password");
    vi.mocked(api.post).mockRejectedValue(unauthorized);

    await expect(
      useWorkspaceStore.getState().unlockPublicTree(TREE_A.id, "wrong"),
    ).rejects.toBe(unauthorized);
    expect(WorkspaceService.resolveLegacyWorkspaceId).not.toHaveBeenCalled();
  });

  it("inserts the tree into the list when reopening one that's missing from it", async () => {
    // Mirrors clicking a "shared with you" notification for a tree that
    // loadTrees() had already dropped (e.g. from a prior connect failure) —
    // connect() succeeds and must add it back, not just try to update an
    // entry that isn't there. Otherwise the tree selector (which renders
    // only from `workspaces`) shows no selection at all even though the store is
    // genuinely connected.
    mockEmptySubStores();
    useWorkspaceStore.setState({ workspaces: [TREE_B] });
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await useWorkspaceStore.getState().openTreeById(TREE_A.id);

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useWorkspaceStore.getState().workspaces.map((t) => t.id)).toEqual([
      TREE_A.id,
      TREE_B.id,
    ]);
  });

  it("opens an outside-tree result, queues its locate, and opens its details", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_B.id, TREE_B);

    await useWorkspaceStore
      .getState()
      .openTreeAndLocateMember(TREE_B.id, "member-b");

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_B.id);
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
      if (path === `/workspaces/${TREE_A.id}`) {
        return Promise.reject(new ApiError(403, "Forbidden"));
      }
      if (path === "/workspaces") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await expect(useWorkspaceStore.getState().connect(TREE_A)).rejects.toThrow();

    // Must not be left half-connected to a tree it can't actually read —
    // a stale selectedTree here is what made the DB selector show a blank
    // entry and the canvas look like an empty "new" tree (#807 follow-up).
    expect(useWorkspaceStore.getState().selectedTree).toBeUndefined();
    expect(useWorkspaceStore.getState().isReady).toBe(false);
  });

  it("still rejects when a concurrent disconnect wins the race before a 403 (#813)", async () => {
    mockEmptySubStores();
    // An SSE-triggered loadTrees() disconnects while connect's GET is in
    // flight; the 403 then arrives with the tree no longer active. The
    // caller (e.g. the notification bell) must still see a rejection so its
    // toast + recovery run — resolving silently strands the user (#813).
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === `/workspaces/${TREE_A.id}`) {
        await useWorkspaceStore.getState().disconnect();
        throw new ApiError(403, "Forbidden");
      }
      if (path === "/workspaces") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await expect(useWorkspaceStore.getState().connect(TREE_A)).rejects.toThrow();

    // The concurrent disconnect is not undone — no stale tree is restored.
    expect(useWorkspaceStore.getState().selectedTree).toBeUndefined();
    expect(useWorkspaceStore.getState().isReady).toBe(false);
  });

  it("lands on the remaining tree instead of a blank canvas after a 403 (#813)", async () => {
    mockEmptySubStores();
    useWorkspaceStore.setState({ workspaces: [TREE_A, TREE_B] });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${TREE_A.id}`) {
        return Promise.reject(new ApiError(403, "Forbidden"));
      }
      if (path === "/workspaces") return Promise.resolve([TREE_B]);
      if (path === `/workspaces/${TREE_B.id}`) return Promise.resolve(TREE_B);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await expect(useWorkspaceStore.getState().connect(TREE_A)).rejects.toThrow();

    // The stale tree is never restored — the caller (e.g. the notification
    // bell) still gets its rejection to show a toast against. But
    // disconnect()'s own loadTrees() no longer sees the stale selection to
    // react to, so connect() must refresh the list and land on the fallback
    // itself, settling on the one remaining tree instead of leaving the
    // canvas blank.
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_B.id);
      expect(useWorkspaceStore.getState().isReady).toBe(true);
    });
  });

  it("selectTree also rejects and disconnects when the target 404s", async () => {
    mockEmptySubStores();
    useWorkspaceStore.setState({ selectedTree: TREE_B, isReady: true });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${TREE_A.id}`) {
        return Promise.reject(new ApiError(404, "Not Found"));
      }
      return Promise.resolve([]);
    });

    await expect(useWorkspaceStore.getState().selectTree(TREE_A)).rejects.toThrow();

    expect(useWorkspaceStore.getState().selectedTree).toBeUndefined();
  });

  it("tolerates a transient (non-access) failure and proceeds with what it has", async () => {
    mockEmptySubStores();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${TREE_A.id}`)
        return Promise.reject(new Error("network error"));
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await useWorkspaceStore.getState().connect(TREE_A);

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });

  it("does not select a slower tree-link response after a newer request", async () => {
    mockEmptySubStores();
    let resolveTreeA: (tree: Workspace) => void = () => undefined;
    const treeAResponse = new Promise<Workspace>((resolve) => {
      resolveTreeA = resolve;
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${TREE_A.id}`) return treeAResponse;
      if (path === `/workspaces/${TREE_B.id}`) return Promise.resolve(TREE_B);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    const slowOpen = useWorkspaceStore.getState().openTreeById(TREE_A.id);
    await useWorkspaceStore.getState().openTreeById(TREE_B.id);
    resolveTreeA(TREE_A);
    await slowOpen;

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_B.id);
  });

  it("continues a public tree link started during session reset", async () => {
    mockEmptySubStores();
    let resolveTree: (tree: Workspace) => void = () => undefined;
    const treeResponse = new Promise<Workspace>((resolve) => {
      resolveTree = resolve;
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${TREE_A.id}`) return treeResponse;
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    const opening = useWorkspaceStore.getState().openTreeById(TREE_A.id);
    resetTreeStoreForSession();
    resolveTree(TREE_A);
    await opening;

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });

  it("invalidates every content store when switching workspaces", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_B.id, TREE_B);
    useWorkspaceStore.setState({ selectedTree: TREE_A, isReady: true });
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

    await useWorkspaceStore.getState().selectTree(TREE_B);

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

    await useWorkspaceStore.getState().connect(TREE_A);

    expect(useWorkspaceStore.getState().isReady).toBe(true);
    // Secondary stores are deferred to first tab visit — connect() does NOT load them.
    expect(WorkspaceService.getGalleryImages).not.toHaveBeenCalled();
    expect(WorkspaceService.getEvents).not.toHaveBeenCalled();
    expect(WorkspaceService.getStories).not.toHaveBeenCalled();
    expect(WorkspaceService.getActivity).not.toHaveBeenCalled();
    // Core stores are still loaded eagerly.
    expect(WorkspaceService.getMembers).toHaveBeenCalled();
    expect(WorkspaceService.getRelationTypes).toHaveBeenCalled();
  });

  it("secondary stores remain deferred on connect", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);

    await useWorkspaceStore.getState().connect(TREE_A);

    expect(useWorkspaceStore.getState().isReady).toBe(true);
    // No secondary stores loaded on connect (deferred to first tab visit).
    expect(WorkspaceService.getGalleryImages).not.toHaveBeenCalled();
    expect(WorkspaceService.getEvents).not.toHaveBeenCalled();
    expect(WorkspaceService.getStories).not.toHaveBeenCalled();
    expect(WorkspaceService.getActivity).not.toHaveBeenCalled();
  });

  it("virtual tree connect still defers secondary stores", async () => {
    const VV: Workspace = {
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

    await useWorkspaceStore.getState().connect(VV);

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(VV.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
    // Secondary stores are deferred even for virtual workspaces.
    expect(WorkspaceService.getGalleryImages).not.toHaveBeenCalled();
    expect(WorkspaceService.getEvents).not.toHaveBeenCalled();
    expect(WorkspaceService.getStories).not.toHaveBeenCalled();
    expect(WorkspaceService.getActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// role / permission workflow
// ---------------------------------------------------------------------------

describe("useWorkspaceStore — role & permissions", () => {
  it("stores the role returned by the server after connect", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_VIEWER.id, { ...TREE_VIEWER });

    await useWorkspaceStore.getState().connect(TREE_VIEWER);

    expect(useWorkspaceStore.getState().selectedTree?.role).toBe("viewer");
  });

  it("stores owner role when server returns owner", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, { ...TREE_A, role: "owner" });

    await useWorkspaceStore.getState().connect(TREE_A);

    expect(useWorkspaceStore.getState().selectedTree?.role).toBe("owner");
  });

  it("stores editor role when server returns editor", async () => {
    mockEmptySubStores();
    mockApiGetForConnect(TREE_B.id, { ...TREE_B, role: "editor" });

    await useWorkspaceStore.getState().connect(TREE_B);

    expect(useWorkspaceStore.getState().selectedTree?.role).toBe("editor");
  });

  it("falls back to the original tree role if the GET /workspaces/:id fails", async () => {
    mockEmptySubStores();
    // connect() catches errors from the GET and continues with local state
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/workspaces/${TREE_A.id}`)
        return Promise.reject(new Error("403"));
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await useWorkspaceStore.getState().connect(TREE_A);

    // Should not throw; selectedTree stays as-is (no crash)
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadTrees — auto-disconnect when selected tree vanishes
// ---------------------------------------------------------------------------

describe("useWorkspaceStore — loadTrees", () => {
  it("auto-selects the most recent remaining tree when the active one disappears", async () => {
    mockEmptySubStores();
    useWorkspaceStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      workspaces: [TREE_A],
    });

    // Server returns a list that no longer includes tree-a
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === "/workspaces") return Promise.resolve([TREE_B]);
      if (path === `/workspaces/${TREE_B.id}`) return Promise.resolve(TREE_B);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });
    vi.mocked(WorkspaceService.listVirtualViews).mockResolvedValue([]);

    await useWorkspaceStore.getState().loadTrees();

    // Lands on the remaining tree (startup's MRU rule) instead of a blank
    // canvas with no selection (#813/#814).
    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_B.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });

  it("auto-disconnects when the active tree is gone and none remain", async () => {
    useWorkspaceStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      workspaces: [TREE_A],
    });

    vi.mocked(api.get).mockResolvedValueOnce([]);
    vi.mocked(WorkspaceService.listVirtualViews).mockResolvedValueOnce([]);

    await useWorkspaceStore.getState().loadTrees();

    expect(useWorkspaceStore.getState().selectedTree).toBeUndefined();
    expect(useWorkspaceStore.getState().isReady).toBe(false);
  });

  it("keeps the selected tree when it is still in the returned list", async () => {
    useWorkspaceStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      workspaces: [TREE_A],
    });

    vi.mocked(api.get).mockResolvedValueOnce([TREE_A, TREE_B]);
    vi.mocked(WorkspaceService.listVirtualViews).mockResolvedValueOnce([]);

    await useWorkspaceStore.getState().loadTrees();

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });

  it("refreshes the selected tree role from the returned list", async () => {
    const retainedTree: Workspace = {
      ...TREE_A,
      role: "viewer",
      restrictions: ["gallery"],
    };
    useWorkspaceStore.setState({
      selectedTree: TREE_A,
      isReady: true,
      workspaces: [TREE_A],
    });

    vi.mocked(api.get).mockResolvedValueOnce([retainedTree, TREE_B]);
    vi.mocked(WorkspaceService.listVirtualViews).mockResolvedValueOnce([]);

    await useWorkspaceStore.getState().loadTrees();

    expect(useWorkspaceStore.getState().selectedTree).toEqual(retainedTree);
    expect(useWorkspaceStore.getState().selectedTree?.role).toBe("viewer");
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createTree
// ---------------------------------------------------------------------------

describe("useWorkspaceStore — createTree", () => {
  it("calls api.post and auto-selects the new tree", async () => {
    const newTree: Workspace = { id: "new-t", name: "New Workspace", role: "owner" };
    vi.mocked(api.post).mockResolvedValueOnce(newTree);
    mockEmptySubStores();
    // selectTree → connect will call api.get for the new tree
    mockApiGetForConnect(newTree.id, newTree);

    const result = await useWorkspaceStore.getState().createTree("New Workspace");

    expect(api.post).toHaveBeenCalledWith(
      "/workspaces",
      expect.objectContaining({ name: "New Workspace" }),
    );
    expect(result.id).toBe("new-t");
    expect(useWorkspaceStore.getState().selectedTree?.id).toBe("new-t");
  });
});

// ---------------------------------------------------------------------------
// deleteTree
// ---------------------------------------------------------------------------

describe("useWorkspaceStore — deleteTree", () => {
  it("removes the tree from the list and disconnects if it was selected", async () => {
    useWorkspaceStore.setState({
      workspaces: [TREE_A, TREE_B],
      selectedTree: TREE_A,
      isReady: true,
    });
    vi.mocked(api.del).mockResolvedValueOnce(undefined);

    await useWorkspaceStore.getState().deleteTree(TREE_A);

    const { workspaces, selectedTree } = useWorkspaceStore.getState();
    expect(workspaces.some((t) => t.id === TREE_A.id)).toBe(false);
    expect(selectedTree).toBeUndefined();
  });

  it("does not disconnect when a non-active tree is deleted", async () => {
    useWorkspaceStore.setState({
      workspaces: [TREE_A, TREE_B],
      selectedTree: TREE_A,
      isReady: true,
    });
    vi.mocked(api.del).mockResolvedValueOnce(undefined);

    await useWorkspaceStore.getState().deleteTree(TREE_B);

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stale-write guard / fast switching
// ---------------------------------------------------------------------------

describe("useWorkspaceStore — stale-write guard / fast switching", () => {
  it("disconnect clears member undo/redo history", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE_A, isReady: true });
    useMemberStore.setState({
      undoStack: [{ undo: async () => {}, redo: async () => {} }],
      redoStack: [{ undo: async () => {}, redo: async () => {} }],
    });

    await useWorkspaceStore.getState().disconnect();

    expect(useMemberStore.getState().undoStack).toHaveLength(0);
    expect(useMemberStore.getState().redoStack).toHaveLength(0);
  });

  it("connect(B) after connect(A) ends with B selected and B's data", async () => {
    // Connect tree A
    mockEmptySubStores();
    mockApiGetForConnect(TREE_A.id, TREE_A);
    await useWorkspaceStore.getState().connect(TREE_A);
    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_A.id);

    // Immediately connect tree B (fast switch)
    mockApiGetForConnect(TREE_B.id, TREE_B);
    await useWorkspaceStore.getState().connect(TREE_B);

    expect(useWorkspaceStore.getState().selectedTree?.id).toBe(TREE_B.id);
    expect(useWorkspaceStore.getState().isReady).toBe(true);
  });

  it("deferred refreshMembers for tree-A is dropped when tree-B is active", async () => {
    // Set up a deferred members fetch for TREE_A
    let resolveA!: (v: never[]) => void;
    const pendingA = new Promise<never[]>((r) => {
      resolveA = r;
    });
    vi.mocked(WorkspaceService.getMembers).mockReturnValue(pendingA);
    vi.mocked(WorkspaceService.getRelations).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getDiseases).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryUnknownFaces).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getActivity).mockResolvedValue({
      entries: [],
      total: 0,
      actors: [],
    });
    vi.mocked(WorkspaceService.getRelationTypes).mockResolvedValue([]);
    mockApiGetForConnect(TREE_A.id, TREE_A);

    // Start connecting A (members fetch is deferred)
    const connectAPromise = useWorkspaceStore.getState().connect(TREE_A);

    // Switch to B before A's member data arrives
    useWorkspaceStore.setState({ selectedTree: TREE_B });

    // Resolve A's deferred fetch
    resolveA([]);
    await connectAPromise;

    // Members should still be empty — stale data dropped
    expect(useMemberStore.getState().members).toHaveLength(0);
  });
});
