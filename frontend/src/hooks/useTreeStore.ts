import { create } from "zustand";
import { Tree } from "@/types/tree";
import { api } from "@/services/api";
import { TreeService } from "@/services/TreeService";
import { RelationType } from "@/types/member";
import { MergeResolution } from "@/types/merge";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";

export const isVirtualId = (id: string) => id.startsWith("vv_");

interface DatabaseMetaData {
  id?: string;
  name?: string;
  createdAt?: string;
  lastOpened?: string;
  hasLayout?: boolean;
  overlapCount?: number;
}

interface DatabaseState {
  trees: Tree[];
  virtualViews: Tree[];
  selectedTree: Tree | undefined;
  metadata: DatabaseMetaData;
  relationTypes: { id: RelationType }[];
  isReady: boolean;

  loadTrees: () => Promise<void>;
  createTree: (name: string, id?: string) => Promise<Tree>;
  renameTree: (tree: Tree, name: string) => Promise<void>;
  deleteTree: (tree: Tree) => Promise<void>;
  mergeTrees: (
    name: string,
    sourceA: string,
    sourceB?: string,
    resolutions?: MergeResolution[],
  ) => Promise<Tree>;
  createVirtualView: (name: string, sourceTreeIds: string[]) => Promise<Tree>;
  renameVirtualView: (view: Tree, name: string) => Promise<void>;
  updateVirtualViewSources: (view: Tree, sourceTreeIds: string[]) => Promise<void>;
  deleteVirtualView: (view: Tree) => Promise<void>;
  recomputeMatches: (view: Tree) => Promise<{ groupCount: number; mergedMemberCount: number }>;
  selectTree: (tree: Tree | undefined) => Promise<void>;
  connect: (tree: Tree) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshMetadata: (treeId?: string) => Promise<void>;
  refreshRelationTypes: (treeId?: string) => Promise<void>;
}

const clearDataStores = () => {
  useMemberStore.getState().clear();
  useGalleryStore.getState().clear();
  useEventStore.getState().clear();
  useStoryStore.getState().clear();
  useActivityStore.getState().clear();
  useStatisticsStore.getState().clear();
};

export const useTreeStore = create<DatabaseState>((set, get) => ({
  trees: [],
  virtualViews: [],
  selectedTree: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,

  loadTrees: async () => {
    const [trees, virtualViews] = await Promise.all([
      api.get<Tree[]>("/trees"),
      TreeService.listVirtualViews().catch(() => [] as Tree[]),
    ]);
    set({ trees, virtualViews });
    // Drop a stale selection that no longer exists / is no longer accessible.
    const selected = get().selectedTree;
    const allItems = [...trees, ...virtualViews];
    if (selected && !allItems.some((t) => t.id === selected.id)) {
      await get().disconnect();
    }
  },

  createTree: async (name: string, id?: string) => {
    const tree = await api.post<Tree>("/trees", { name, id });
    set((s) => ({ trees: [tree, ...s.trees] }));
    await get().selectTree(tree);
    return tree;
  },

  renameTree: async (tree: Tree, name: string) => {
    const updated = await api.patch<Tree>(`/trees/${tree.id}`, { name });
    set((s) => ({
      trees: s.trees.map((t) => (t.id === tree.id ? updated : t)),
      selectedTree: s.selectedTree?.id === tree.id ? updated : s.selectedTree,
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
    const tree = await api.post<Tree>("/trees/merge", {
      name,
      source_a: sourceA,
      source_b: sourceB ?? null,
      resolutions: resolutions ?? null,
    });
    await get().loadTrees();
    await get().selectTree(tree);
    return tree;
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
      selectedTree:
        s.selectedTree?.id === view.id ? updated : s.selectedTree,
    }));
  },

  updateVirtualViewSources: async (view: Tree, sourceTreeIds: string[]) => {
    const updated = await TreeService.updateVirtualView(view.id, {
      source_tree_ids: sourceTreeIds,
    });
    set((s) => ({
      virtualViews: s.virtualViews.map((v) => (v.id === view.id ? updated : v)),
      selectedTree:
        s.selectedTree?.id === view.id ? updated : s.selectedTree,
    }));
  },

  deleteVirtualView: async (view: Tree) => {
    await TreeService.deleteVirtualView(view.id);
    const wasSelected = get().selectedTree?.id === view.id;
    set((s) => ({
      virtualViews: s.virtualViews.filter((v) => v.id !== view.id),
    }));
    if (wasSelected) await get().disconnect();
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

    if (isVirtualId(tree.id)) {
      // Virtual views are read-only composites — no gallery/events/stories.
      try {
        const fresh = await api.get<Tree>(`/virtual-views/${tree.id}`);
        set((s) => ({
          selectedTree: fresh,
          virtualViews: s.virtualViews.map((v) =>
            v.id === fresh.id ? fresh : v,
          ),
        }));
      } catch {
        // non-fatal; continue with what we have
      }
      useGalleryStore.getState().clear();
      useEventStore.getState().clear();
      useStoryStore.getState().clear();
      useActivityStore.getState().clear();
      useStatisticsStore.getState().clear();
      await Promise.all([
        get().refreshMetadata(tree.id),
        get().refreshRelationTypes(tree.id),
        useMemberStore.getState().refreshMembers(tree.id),
      ]);
      // Only auto-layout when there are no saved overlay positions yet.
      // Once the user has arranged the view, respect those positions.
      if (get().metadata.hasLayout !== true) {
        await useMemberStore.getState().updateLayout();
      }
    } else {
      // Marks the tree as "opened" server-side and returns the latest role.
      try {
        const fresh = await api.get<Tree>(`/trees/${tree.id}`);
        set((s) => ({
          selectedTree: fresh,
          trees: s.trees.map((t) => (t.id === fresh.id ? fresh : t)),
        }));
      } catch {
        // non-fatal; continue with what we have
      }
      await Promise.all([
        get().refreshMetadata(tree.id),
        get().refreshRelationTypes(tree.id),
        useMemberStore.getState().refreshMembers(tree.id),
        useGalleryStore.getState().refreshGalleryImages(tree.id),
        useEventStore.getState().refreshEvents(tree.id),
        useStoryStore.getState().refreshStories(tree.id),
        useActivityStore.getState().refreshActivity(tree.id),
      ]);
    }
    set({ isReady: true });
  },

  disconnect: async () => {
    set({
      selectedTree: undefined,
      isReady: false,
      metadata: {},
      relationTypes: [],
    });
    clearDataStores();
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

  refreshRelationTypes: async (treeId = activeTreeId()) => {
    if (!treeId) return;
    const types = await TreeService.getRelationTypes(treeId);
    if (!isActiveTree(treeId)) return;
    set({ relationTypes: types });
  },

}));

/** Convenience accessor used by the data stores. */
export const activeTreeId = (): string | undefined =>
  useTreeStore.getState().selectedTree?.id;

/** Stale-write guard for async loaders: true if `treeId` is still the active tree. */
export const isActiveTree = (treeId: string | undefined): boolean =>
  treeId !== undefined && activeTreeId() === treeId;
