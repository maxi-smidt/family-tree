import { create } from "zustand";
import { Tree } from "@/types/tree";
import { api } from "@/services/api";
import { TreeService } from "@/services/TreeService";
import { RelationType } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";

interface DatabaseMetaData {
  id?: string;
  name?: string;
  createdAt?: string;
  lastOpened?: string;
}

interface DatabaseState {
  trees: Tree[];
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
  ) => Promise<Tree>;
  selectTree: (tree: Tree | undefined) => Promise<void>;
  connect: (tree: Tree) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshMetadata: (treeId?: string) => Promise<void>;
  refreshRelationTypes: (treeId?: string) => Promise<void>;
  addRelationType: (id: string, description: string) => Promise<void>;
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
  selectedTree: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,

  loadTrees: async () => {
    const trees = await api.get<Tree[]>("/trees");
    set({ trees: trees });
    // Drop a stale selection that no longer exists / is no longer accessible.
    const selected = get().selectedTree;
    if (selected && !trees.some((t) => t.id === selected.id)) {
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

  mergeTrees: async (name: string, sourceA: string, sourceB?: string) => {
    const tree = await api.post<Tree>("/trees/merge", {
      name,
      source_a: sourceA,
      source_b: sourceB ?? null,
    });
    await get().loadTrees();
    await get().selectTree(tree);
    return tree;
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
    const metadata = await api.get<DatabaseMetaData>(
      `/trees/${treeId}/metadata`,
    );
    if (!isActiveTree(treeId)) return;
    set({ metadata });
  },

  refreshRelationTypes: async (treeId = activeTreeId()) => {
    if (!treeId) return;
    const types = await TreeService.getRelationTypes(treeId);
    if (!isActiveTree(treeId)) return;
    set({ relationTypes: types });
  },

  addRelationType: async (id: string, description: string) => {
    const tree = get().selectedTree;
    if (!tree) return;
    await TreeService.addRelationType(tree.id, id, description);
    await get().refreshRelationTypes();
  },
}));

/** Convenience accessor used by the data stores. */
export const activeTreeId = (): string | undefined =>
  useTreeStore.getState().selectedTree?.id;

/** Stale-write guard for async loaders: true if `treeId` is still the active tree. */
export const isActiveTree = (treeId: string | undefined): boolean =>
  treeId !== undefined && activeTreeId() === treeId;
