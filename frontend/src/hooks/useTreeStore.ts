import { create } from "zustand";
import {
  SubtreeExtractPayload,
  SubtreeExtractPreview,
  Tree,
} from "@/types/tree";
import { api, setPublicTreeToken } from "@/services/api";
import { TreeService } from "@/services/TreeService";
import { TreeSharingService } from "@/services/TreeSharingService";
import {
  Member,
  MemberDB,
  RelationTypeDB,
  mapMemberFromDB,
} from "@/types/member";
import { MergeFieldChoice, MergeResolution } from "@/types/merge";
import { useJobStore } from "@/hooks/useJobStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { hasFeature } from "@/hooks/useAuthStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";

export const isVirtualId = (id: string) => id.startsWith("vv_");

// Incremented for every explicit tree transition so a slower link resolution
// cannot select a tree after a newer selection or disconnect has won.
let treeRequestVersion = 0;

interface DatabaseMetaData {
  id?: string;
  name?: string;
  createdAt?: string;
  lastOpened?: string;
  hasLayout?: boolean;
  overlapCount?: number;
}

/** One hop in the tree-in-tree breadcrumb: a tree the user navigated *from*. */
interface TreeNavEntry {
  id: string;
  name: string;
}

interface DatabaseState {
  trees: Tree[];
  virtualViews: Tree[];
  selectedTree: Tree | undefined;
  metadata: DatabaseMetaData;
  relationTypes: RelationTypeDB[];
  isReady: boolean;
  // Ancestor chain for the tree-in-tree feature: the trees the user came from
  // when following member→tree links. Empty when viewing a top-level tree.
  treeNavStack: TreeNavEntry[];

  loadTrees: () => Promise<void>;
  openTreeById: (treeId: string) => Promise<Tree>;
  openTreeAndLocateMember: (treeId: string, memberId: string) => Promise<void>;
  unlockPublicTree: (treeId: string, password: string) => Promise<Tree>;
  createTree: (name: string, options?: { select?: boolean }) => Promise<Tree>;
  openLinkedTree: (
    treeId: string,
    focusMemberId?: string | null,
  ) => Promise<void>;
  createLinkedSubtree: (memberId: string, name: string) => Promise<Tree>;
  linkExistingTree: (
    memberId: string,
    body: {
      linked_tree_id: string;
      mode: "existing" | "create";
      counterpart_member_id?: string | null;
      field_choices?: Partial<Record<string, MergeFieldChoice>>;
    },
  ) => Promise<Tree>;
  navigateToTreeStack: (index: number) => Promise<void>;
  renameTree: (tree: Tree, name: string) => Promise<void>;
  updateTree: (tree: Tree) => void;
  deleteTree: (tree: Tree) => Promise<void>;
  mergeTrees: (
    name: string,
    sourceA: string,
    sourceB?: string,
    resolutions?: MergeResolution[],
  ) => Promise<Tree>;
  extractSubtree: (payload: SubtreeExtractPayload) => Promise<Tree>;
  extractSubtreePreview: (
    payload: Omit<SubtreeExtractPayload, "name">,
  ) => Promise<SubtreeExtractPreview>;
  fetchTreeMembers: (treeId: string) => Promise<Member[]>;
  createVirtualView: (name: string, sourceTreeIds: string[]) => Promise<Tree>;
  renameVirtualView: (view: Tree, name: string) => Promise<void>;
  updateVirtualViewSources: (
    view: Tree,
    sourceTreeIds: string[],
  ) => Promise<void>;
  deleteVirtualView: (view: Tree) => Promise<void>;
  recomputeMatches: (
    view: Tree,
  ) => Promise<{ groupCount: number; mergedMemberCount: number }>;
  selectTree: (tree: Tree | undefined) => Promise<void>;
  connect: (tree: Tree) => Promise<void>;
  disconnect: () => Promise<void>;
  disconnectPublicTree: () => Promise<void>;
  refreshMetadata: (treeId?: string) => Promise<void>;
  refreshRelationTypes: () => Promise<void>;
}

const clearDataStores = () => {
  useMemberStore.getState().clear();
  useGalleryStore.getState().clear();
  useEventStore.getState().clear();
  useStoryStore.getState().clear();
  useDocumentStore.getState().clear();
  useActivityStore.getState().clear();
  useStatisticsStore.getState().clear();
  useQualityReportStore.getState().clear();
  useStorageStore.getState().clear();
};

export const useTreeStore = create<DatabaseState>((set, get) => ({
  trees: [],
  virtualViews: [],
  selectedTree: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,
  treeNavStack: [],

  loadTrees: async () => {
    const [trees, virtualViews] = await Promise.all([
      api.get<Tree[]>("/trees"),
      hasFeature("virtual_views")
        ? TreeService.listVirtualViews().catch(() => [] as Tree[])
        : Promise.resolve([] as Tree[]),
    ]);
    set({ trees, virtualViews });
    // Drop a stale selection that no longer exists / is no longer accessible.
    const selected = get().selectedTree;
    const allItems = [...trees, ...virtualViews];
    if (selected) {
      const freshSelected = allItems.find((t) => t.id === selected.id);
      if (freshSelected) {
        set({ selectedTree: freshSelected });
      } else {
        await get().disconnect();
      }
    }
  },

  // Resolve a tree before selecting it. This keeps link routing, including
  // public-tree links that are absent from a user's normal tree list, inside
  // the tree domain rather than making view components call the API directly.
  openTreeById: async (treeId: string) => {
    const requestVersion = ++treeRequestVersion;
    const tree = await api.get<Tree>(`/trees/${treeId}`);
    if (requestVersion !== treeRequestVersion) return tree;
    await get().selectTree(tree);
    return tree;
  },

  openTreeAndLocateMember: async (treeId: string, memberId: string) => {
    const tree = await get().openTreeById(treeId);
    if (!isActiveTree(tree.id)) return;
    useMemberSheetStore.getState().setOpenSheet(tree.id, {
      memberId,
      tab: "identity",
      mode: "view",
    });
    // Set after the tree transition: connect() clears the member store, and
    // the canvas consumes this once the selected member has finished loading.
    useMemberStore.getState().setPendingLocateMemberId(memberId);
  },

  unlockPublicTree: async (treeId: string, password: string) => {
    const { token } = await TreeSharingService.unlockPublicTree(
      treeId,
      password,
    );
    setPublicTreeToken(token);
    return get().openTreeById(treeId);
  },

  createTree: async (name: string, options?: { select?: boolean }) => {
    const tree = await api.post<Tree>("/trees", { name });
    set((s) => ({ trees: [tree, ...s.trees] }));
    // `select: false` lets callers create a tree without switching to it — used
    // by the tree-in-tree "create & link" action so the current edit context is
    // preserved.
    if (options?.select !== false) {
      await get().selectTree(tree);
    }
    return tree;
  },

  // Follow a member→tree link: remember where we came from (breadcrumb), verify
  // the target is accessible, then switch to it. Throws if the linked tree is
  // missing or the user has no access, so callers can surface a message.
  // When the link carries a counterpart member (the bridge person's row in the
  // target tree), the canvas centers on it after the switch.
  openLinkedTree: async (treeId: string, focusMemberId?: string | null) => {
    const current = get().selectedTree;
    if (!current || current.id === treeId) return;
    const target = await api.get<Tree>(`/trees/${treeId}`);
    // Following a back-link to where we just came from behaves like "back":
    // pop the breadcrumb instead of growing it (A → B → A stays two levels).
    const stack = get().treeNavStack;
    const last = stack[stack.length - 1];
    if (last && last.id === treeId) {
      set({ treeNavStack: stack.slice(0, -1) });
    } else {
      set({
        treeNavStack: [...stack, { id: current.id, name: current.name }],
      });
    }
    await get().connect(target);
    if (focusMemberId) {
      // Set after connect: the tree switch clears the member store, and the
      // canvas consumes this once the counterpart is present in `members`.
      useMemberStore.getState().setPendingLocateMemberId(focusMemberId);
    }
  },

  // Tree-in-tree "create & link": one atomic backend call creates the new
  // tree, seeds it with a copy of the member (the bridge person) and links
  // the two rows bidirectionally. The current tree stays selected; the
  // updated anchor is reflected into the member store so the badge appears.
  createLinkedSubtree: async (memberId: string, name: string) => {
    const current = get().selectedTree;
    if (!current) throw new Error("No tree selected");
    const res = await TreeService.createMemberSubtree(
      current.id,
      memberId,
      name,
    );
    set((s) => ({ trees: [res.tree, ...s.trees] }));
    useMemberStore.setState((s) => ({
      members: s.members.map((m) =>
        m.id === memberId
          ? {
              ...m,
              linkedTreeId: res.anchor.linkedTreeId ?? null,
              linkedMemberId: res.anchor.linkedMemberId ?? null,
            }
          : m,
      ),
    }));
    return res.tree;
  },

  // Tree-in-tree "link existing tree": resolves a bridge person against an
  // already-existing target tree — either an existing member the caller
  // asserts is the same person, or a fresh copy seeded into the target. The
  // current tree stays selected; the updated anchor is reflected into the
  // member store so the badge appears immediately.
  linkExistingTree: async (memberId, body) => {
    const current = get().selectedTree;
    if (!current) throw new Error("No tree selected");
    const res = await TreeService.linkMemberToTree(current.id, memberId, body);
    set((s) => ({
      trees: s.trees.some((t) => t.id === res.tree.id)
        ? s.trees
        : [res.tree, ...s.trees],
    }));
    useMemberStore.setState((s) => ({
      members: s.members.map((m) =>
        m.id === memberId
          ? {
              ...m,
              linkedTreeId: res.anchor.linkedTreeId ?? null,
              linkedMemberId: res.anchor.linkedMemberId ?? null,
            }
          : m,
      ),
    }));
    return res.tree;
  },

  // Jump back to an ancestor in the breadcrumb, dropping everything below it.
  navigateToTreeStack: async (index: number) => {
    const entry = get().treeNavStack[index];
    if (!entry) return;
    set((s) => ({ treeNavStack: s.treeNavStack.slice(0, index) }));
    await get().connect({ id: entry.id, name: entry.name });
  },

  renameTree: async (tree: Tree, name: string) => {
    const updated = await api.patch<Tree>(`/trees/${tree.id}`, { name });
    set((s) => ({
      trees: s.trees.map((t) => (t.id === tree.id ? updated : t)),
      selectedTree: s.selectedTree?.id === tree.id ? updated : s.selectedTree,
    }));
  },

  updateTree: (tree: Tree) => {
    set((s) => ({
      trees: s.trees.map((t) => (t.id === tree.id ? tree : t)),
      selectedTree: s.selectedTree?.id === tree.id ? tree : s.selectedTree,
    }));
  },

  deleteTree: async (tree: Tree) => {
    await api.del(`/trees/${tree.id}`);
    const wasSelected = get().selectedTree?.id === tree.id;
    set((s) => ({
      trees: s.trees.filter((t) => t.id !== tree.id),
    }));
    if (wasSelected) await get().disconnect();
  },

  mergeTrees: async (
    name: string,
    sourceA: string,
    sourceB?: string,
    resolutions?: MergeResolution[],
  ) => {
    const { job_id } = await api.post<{ job_id: string }>("/trees/merge", {
      name,
      source_a: sourceA,
      source_b: sourceB ?? null,
      resolutions: resolutions ?? null,
    });
    const treeId = await useJobStore.getState().trackJob(job_id);
    const tree = await api.get<Tree>(`/trees/${treeId}`);
    await get().loadTrees();
    await get().selectTree(tree);
    return tree;
  },

  extractSubtree: async (payload) => {
    const { job_id } = await TreeService.extractSubtree(payload);
    const treeId = await useJobStore.getState().trackJob(job_id);
    const tree = await api.get<Tree>(`/trees/${treeId}`);
    await get().loadTrees();
    await get().selectTree(tree);
    return tree;
  },

  extractSubtreePreview: async (payload) => {
    return TreeService.previewSubtree(payload);
  },

  fetchTreeMembers: async (treeId: string) => {
    const rows = await TreeService.getMembers(treeId);
    return (rows as MemberDB[]).map((r) => mapMemberFromDB(r));
  },

  createVirtualView: async (name: string, sourceTreeIds: string[]) => {
    const view = await TreeService.createVirtualView(name, sourceTreeIds);
    set((s) => ({ virtualViews: [view, ...s.virtualViews] }));
    await get().selectTree(view);
    return view;
  },

  renameVirtualView: async (view: Tree, name: string) => {
    const updated = await TreeService.updateVirtualView(view.id, { name });
    set((s) => ({
      virtualViews: s.virtualViews.map((v) => (v.id === view.id ? updated : v)),
      selectedTree: s.selectedTree?.id === view.id ? updated : s.selectedTree,
    }));
  },

  updateVirtualViewSources: async (view: Tree, sourceTreeIds: string[]) => {
    const updated = await TreeService.updateVirtualView(view.id, {
      source_tree_ids: sourceTreeIds,
    });
    set((s) => ({
      virtualViews: s.virtualViews.map((v) => (v.id === view.id ? updated : v)),
      selectedTree: s.selectedTree?.id === view.id ? updated : s.selectedTree,
    }));
  },

  deleteVirtualView: async (view: Tree) => {
    await TreeService.deleteVirtualView(view.id);
    const wasSelected = get().selectedTree?.id === view.id;
    set((s) => ({
      virtualViews: s.virtualViews.filter((v) => v.id !== view.id),
    }));
    if (wasSelected) {
      // Fall back to another tree (or remaining view) instead of leaving the
      // app in the "no database" state.
      const { trees, virtualViews } = get();
      const next = trees[0] ?? virtualViews[0];
      if (next) await get().selectTree(next);
      else await get().disconnect();
    }
  },

  recomputeMatches: async (view: Tree) => {
    const result = await TreeService.recomputeVirtualViewMatches(view.id);
    const treeId = get().selectedTree?.id;
    if (treeId === view.id) {
      await useMemberStore.getState().refreshMembers(treeId);
      await get().refreshMetadata(treeId);
    }
    return result;
  },

  selectTree: async (tree: Tree | undefined) => {
    treeRequestVersion += 1;
    // Picking a tree directly (e.g. from the database selector) resets the
    // tree-in-tree breadcrumb; only link-following keeps the ancestor chain.
    set({ treeNavStack: [] });
    if (!tree) {
      await get().disconnect();
      return;
    }
    set({ selectedTree: tree });
    await get().connect(tree);
  },

  connect: async (tree: Tree) => {
    set({
      selectedTree: tree,
      isReady: false,
      metadata: {},
      relationTypes: [],
    });

    // Switching directly between trees does not go through disconnect(). Clear
    // every content store here so deferred views do not retain their previous
    // tree's data or initialized state while they wait for their first visit.
    clearDataStores();

    const virtual = isVirtualId(tree.id);

    // Marks the tree/view as "opened" server-side and returns the latest
    // role + (for views) the resolved source list.
    try {
      const fresh = await api.get<Tree>(
        virtual ? `/virtual-views/${tree.id}` : `/trees/${tree.id}`,
      );
      // A later selection or disconnect supersedes this request. Do not let
      // its response restore a stale tree after the newer transition wins.
      if (!isActiveTree(tree.id)) return;
      set((s) => ({
        selectedTree: fresh,
        trees: virtual
          ? s.trees
          : s.trees.map((t) => (t.id === fresh.id ? fresh : t)),
        virtualViews: virtual
          ? s.virtualViews.map((v) => (v.id === fresh.id ? fresh : v))
          : s.virtualViews,
      }));
    } catch {
      // non-fatal; continue with what we have
      if (!isActiveTree(tree.id)) return;
    }

    const loads = [
      get().refreshMetadata(tree.id),
      get().refreshRelationTypes(),
      useMemberStore.getState().refreshMembers(tree.id),
    ];
    await Promise.allSettled(loads);
    if (!isActiveTree(tree.id)) return;

    // Virtual trees are read-only composites: auto-arrange the layout only
    // until the user saves an alignment overlay, then respect it.
    if (virtual && get().metadata.hasLayout !== true) {
      await useMemberStore.getState().updateLayout();
    }

    // Freshly extracted (or seeded) trees: every member sits at (0, 0)
    // because they've never been arranged. Auto-arrange on first open,
    // same as virtual views, instead of showing a pile of stacked nodes.
    const freshRole = get().selectedTree?.role;
    const canWrite = freshRole === "owner" || freshRole === "editor";
    if (!virtual && canWrite) {
      const members = useMemberStore.getState().members;
      if (
        members.length >= 2 &&
        members.every((m) => m.position.x === 0 && m.position.y === 0)
      ) {
        await useMemberStore.getState().updateLayout();
      }
    }
    if (isActiveTree(tree.id)) set({ isReady: true });
  },

  disconnect: async () => {
    treeRequestVersion += 1;
    set({
      selectedTree: undefined,
      isReady: false,
      metadata: {},
      relationTypes: [],
    });
    clearDataStores();
  },

  disconnectPublicTree: async () => {
    await get().disconnect();
    // Public unlock tokens are in-memory only and must not survive leaving a
    // public view, including a later switch to an authenticated session.
    setPublicTreeToken(null);
  },

  refreshMetadata: async (treeId = activeTreeId()) => {
    if (!treeId) return;
    const basePath = isVirtualId(treeId)
      ? `/virtual-views/${treeId}`
      : `/trees/${treeId}`;
    const metadata = await api.get<DatabaseMetaData>(`${basePath}/metadata`);
    if (!isActiveTree(treeId)) return;
    set({ metadata });
  },

  refreshRelationTypes: async () => {
    const types = await TreeService.getRelationTypes();
    set({ relationTypes: types });
  },
}));

/** Convenience accessor used by the data stores. */
export const activeTreeId = (): string | undefined =>
  useTreeStore.getState().selectedTree?.id;

/** Stale-write guard for async loaders: true if `treeId` is still the active tree. */
export const isActiveTree = (treeId: string | undefined): boolean =>
  treeId !== undefined && activeTreeId() === treeId;

export const resetTreeStoreForSession = () => {
  useTreeStore.setState({
    trees: [],
    virtualViews: [],
    selectedTree: undefined,
    metadata: {},
    relationTypes: [],
    isReady: false,
    treeNavStack: [],
  });
  clearDataStores();
};
