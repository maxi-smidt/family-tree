import { create } from "zustand";
import { Database as Tree } from "@/types/database";
import { api } from "@/services/api";
import { DatabaseService } from "@/services/DatabaseService";
import { RelationType } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";

interface DatabaseMetaData {
  id?: string;
  name?: string;
  createdAt?: string;
  lastOpened?: string;
}

interface DatabaseState {
  databases: Tree[];
  selectedDatabase: Tree | undefined;
  metadata: DatabaseMetaData;
  relationTypes: { id: RelationType }[];
  isReady: boolean;

  loadTrees: () => Promise<void>;
  createDatabase: (name: string, id?: string) => Promise<Tree>;
  renameDatabase: (tree: Tree, name: string) => Promise<void>;
  deleteDatabase: (tree: Tree) => Promise<void>;
  mergeDatabases: (
    name: string,
    sourceA: string,
    sourceB?: string,
  ) => Promise<Tree>;
  selectDatabase: (tree: Tree | undefined) => Promise<void>;
  connect: (tree: Tree) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshMetadata: () => Promise<void>;
  refreshRelationTypes: () => Promise<void>;
  addRelationType: (id: string, description: string) => Promise<void>;
}

const clearDataStores = async () => {
  await Promise.all([
    useMemberStore.getState().refreshMembers(),
    useGalleryStore.getState().refreshGalleryImages(),
    useEventStore.getState().refreshEvents(),
    useStoryStore.getState().refreshStories(),
  ]);
};

export const useDatabaseStore = create<DatabaseState>((set, get) => ({
  databases: [],
  selectedDatabase: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,

  loadTrees: async () => {
    const trees = await api.get<Tree[]>("/trees");
    set({ databases: trees });
    // Drop a stale selection that no longer exists / is no longer accessible.
    const selected = get().selectedDatabase;
    if (selected && !trees.some((t) => t.id === selected.id)) {
      await get().disconnect();
    }
  },

  createDatabase: async (name: string, id?: string) => {
    const tree = await api.post<Tree>("/trees", { name, id });
    set((s) => ({ databases: [tree, ...s.databases] }));
    await get().selectDatabase(tree);
    return tree;
  },

  renameDatabase: async (tree: Tree, name: string) => {
    const updated = await api.patch<Tree>(`/trees/${tree.id}`, { name });
    set((s) => ({
      databases: s.databases.map((t) => (t.id === tree.id ? updated : t)),
      selectedDatabase:
        s.selectedDatabase?.id === tree.id ? updated : s.selectedDatabase,
    }));
  },

  deleteDatabase: async (tree: Tree) => {
    await api.del(`/trees/${tree.id}`);
    const wasSelected = get().selectedDatabase?.id === tree.id;
    set((s) => ({
      databases: s.databases.filter((t) => t.id !== tree.id),
    }));
    if (wasSelected) await get().disconnect();
  },

  mergeDatabases: async (name: string, sourceA: string, sourceB?: string) => {
    const tree = await api.post<Tree>("/trees/merge", {
      name,
      source_a: sourceA,
      source_b: sourceB ?? null,
    });
    await get().loadTrees();
    await get().selectDatabase(tree);
    return tree;
  },

  selectDatabase: async (tree: Tree | undefined) => {
    if (!tree) {
      await get().disconnect();
      return;
    }
    set({ selectedDatabase: tree });
    await get().connect(tree);
  },

  connect: async (tree: Tree) => {
    set({
      selectedDatabase: tree,
      isReady: false,
      metadata: {},
      relationTypes: [],
    });
    // Marks the tree as "opened" server-side and returns the latest role.
    try {
      const fresh = await api.get<Tree>(`/trees/${tree.id}`);
      set((s) => ({
        selectedDatabase: fresh,
        databases: s.databases.map((t) => (t.id === fresh.id ? fresh : t)),
      }));
    } catch {
      // non-fatal; continue with what we have
    }

    await Promise.all([
      get().refreshMetadata(),
      get().refreshRelationTypes(),
      useMemberStore.getState().refreshMembers(),
      useGalleryStore.getState().refreshGalleryImages(),
      useEventStore.getState().refreshEvents(),
      useStoryStore.getState().refreshStories(),
    ]);
    set({ isReady: true });
  },

  disconnect: async () => {
    set({
      selectedDatabase: undefined,
      isReady: false,
      metadata: {},
      relationTypes: [],
    });
    await clearDataStores();
  },

  refreshMetadata: async () => {
    const tree = get().selectedDatabase;
    if (!tree) return;
    const metadata = await api.get<DatabaseMetaData>(
      `/trees/${tree.id}/metadata`,
    );
    set({ metadata });
  },

  refreshRelationTypes: async () => {
    const tree = get().selectedDatabase;
    if (!tree) return;
    const types = await DatabaseService.getRelationTypes(tree.id);
    set({ relationTypes: types });
  },

  addRelationType: async (id: string, description: string) => {
    const tree = get().selectedDatabase;
    if (!tree) return;
    await DatabaseService.addRelationType(tree.id, id, description);
    await get().refreshRelationTypes();
  },
}));

/** Convenience accessor used by the data stores. */
export const activeTreeId = (): string | undefined =>
  useDatabaseStore.getState().selectedDatabase?.id;
