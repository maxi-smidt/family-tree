import { create } from "zustand";
import { Workspace } from "@/types/workspace";
import { ApiError, api, setPublicTreeToken } from "@/services/api";
import { WorkspaceService } from "@/services/WorkspaceService";
import { WorkspaceSharingService } from "@/services/WorkspaceSharingService";
import {
  Member,
  MemberDB,
  RelationTypeDB,
  mapMemberFromDB,
} from "@/types/member";
import { MergeResolution } from "@/types/merge";
import { useJobStore } from "@/hooks/useJobStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { clearTaskStore } from "@/hooks/taskStoreRegistry";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { useWorkspaceNavStore } from "@/hooks/useWorkspaceNavStore";

// A 403/404 against `workspaceId` gets one fallback attempt through the
// v1->v2 migration mapping (#1012): the id may be a stale deep link or
// public bookmark from before the conversion folded that workspace into
// another one. Returns the current id, or null if there's no mapping (the
// caller should surface the original error instead).
async function resolveLegacyWorkspaceIdOnFailure(
  workspaceId: string,
  error: unknown,
): Promise<string | null> {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status !== 403 && status !== 404) return null;
  const targetId = await WorkspaceService.resolveLegacyWorkspaceId(
    workspaceId,
  ).catch(() => null);
  return targetId && targetId !== workspaceId ? targetId : null;
}

// Incremented for every explicit tree transition so a slower link resolution
// cannot select a tree after a newer selection or disconnect has won.
let treeRequestVersion = 0;

interface DatabaseMetaData {
  id?: string;
  name?: string;
  createdAt?: string;
  lastOpened?: string;
  overlapCount?: number;
}

/** One hop in the tree-in-tree breadcrumb: a tree the user navigated *from*. */
interface WorkspaceNavEntry {
  id: string;
  name: string;
}

interface DatabaseState {
  workspaces: Workspace[];
  selectedTree: Workspace | undefined;
  metadata: DatabaseMetaData;
  relationTypes: RelationTypeDB[];
  isReady: boolean;
  // Ancestor chain for the tree-in-tree feature: the workspaces the user came from
  // when following member→tree links. Empty when viewing a top-level tree.
  workspaceNavStack: WorkspaceNavEntry[];

  loadTrees: () => Promise<void>;
  openTreeById: (workspaceId: string) => Promise<Workspace>;
  openTreeAndLocateMember: (
    workspaceId: string,
    memberId: string,
  ) => Promise<void>;
  unlockPublicTree: (
    workspaceId: string,
    password: string,
  ) => Promise<Workspace>;
  createTree: (
    name: string,
    options?: { select?: boolean },
  ) => Promise<Workspace>;
  navigateToTreeStack: (index: number) => Promise<void>;
  renameTree: (tree: Workspace, name: string) => Promise<void>;
  updateTree: (tree: Workspace) => void;
  deleteTree: (tree: Workspace) => Promise<void>;
  mergeTrees: (
    name: string,
    sourceA: string,
    sourceB?: string,
    resolutions?: MergeResolution[],
  ) => Promise<Workspace>;
  fetchTreeMembers: (workspaceId: string) => Promise<Member[]>;
  selectTree: (tree: Workspace | undefined) => Promise<void>;
  connect: (tree: Workspace) => Promise<void>;
  disconnect: () => Promise<void>;
  disconnectPublicTree: () => Promise<void>;
  refreshMetadata: (workspaceId?: string) => Promise<void>;
  refreshRelationTypes: () => Promise<void>;
}

const clearDataStores = () => {
  useMemberStore.getState().clear();
  useGalleryStore.getState().clear();
  useEventStore.getState().clear();
  useStoryStore.getState().clear();
  clearTaskStore();
  useDocumentStore.getState().clear();
  useActivityStore.getState().clear();
  useStatisticsStore.getState().clear();
  useQualityReportStore.getState().clear();
  useStorageStore.getState().clear();
  useSectionStore.getState().clear();
  useSavedViewStore.getState().clear();
  useWorkspaceNavStore.getState().clear();
  useIdentityLinkStore.getState().clear();
};

// Land on the most recently used remaining tree (the API sorts by
// last_opened — same rule as startup in App.tsx) instead of leaving a blank
// canvas, when nothing is currently selected. Shared by loadTrees() and
// connect()'s revoked-access recovery — both disconnect first (for an
// immediate, deterministic UI reset), which clears `selectedTree` before this
// runs, so it must read the *current* workspaces rather than rely on the
// stale selection that triggered the disconnect. Best effort: if the
// fallback tree fails to open, stay disconnected.
const selectFallbackTree = async (get: () => DatabaseState) => {
  if (get().selectedTree) return;
  const next = get().workspaces[0];
  if (next) {
    await get()
      .selectTree(next)
      .catch(() => {});
  }
};

export const useWorkspaceStore = create<DatabaseState>((set, get) => ({
  workspaces: [],
  selectedTree: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,
  workspaceNavStack: [],

  loadTrees: async () => {
    const workspaces = await api.get<Workspace[]>("/workspaces");
    set({ workspaces });
    // Drop a stale selection that no longer exists / is no longer accessible.
    const selected = get().selectedTree;
    if (!selected) return;
    const freshSelected = workspaces.find((t) => t.id === selected.id);
    if (freshSelected) {
      set({ selectedTree: freshSelected });
      return;
    }
    await get().disconnect();
    await selectFallbackTree(get);
  },

  // Resolve a tree before selecting it. This keeps link routing, including
  // public-tree links that are absent from a user's normal tree list, inside
  // the tree domain rather than making view components call the API directly.
  // The legacy-id fallback (#1012) covers every caller — the authenticated
  // deep-link bootstrap in App.tsx and the anonymous PublicTreeViewer both go
  // through here.
  openTreeById: async (workspaceId: string) => {
    const requestVersion = ++treeRequestVersion;
    let tree: Workspace;
    try {
      tree = await api.get<Workspace>(`/workspaces/${workspaceId}`);
    } catch (error) {
      const targetId = await resolveLegacyWorkspaceIdOnFailure(
        workspaceId,
        error,
      );
      if (!targetId) throw error;
      tree = await api.get<Workspace>(`/workspaces/${targetId}`);
    }
    if (requestVersion !== treeRequestVersion) return tree;
    await get().selectTree(tree);
    return tree;
  },

  openTreeAndLocateMember: async (workspaceId: string, memberId: string) => {
    const tree = await get().openTreeById(workspaceId);
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

  // Same legacy-id fallback as openTreeById: a stale bookmark's password
  // gate lives under the id the conversion mapped it to (the old workspace
  // row is gone), so the unlock POST itself needs the resolved id, not just
  // the follow-up openTreeById below.
  unlockPublicTree: async (workspaceId: string, password: string) => {
    let targetId = workspaceId;
    try {
      const { token } = await WorkspaceSharingService.unlockPublicTree(
        targetId,
        password,
      );
      setPublicTreeToken(token);
    } catch (error) {
      const resolvedId = await resolveLegacyWorkspaceIdOnFailure(
        workspaceId,
        error,
      );
      if (!resolvedId) throw error;
      targetId = resolvedId;
      const { token } = await WorkspaceSharingService.unlockPublicTree(
        targetId,
        password,
      );
      setPublicTreeToken(token);
    }
    return get().openTreeById(targetId);
  },

  createTree: async (name: string, options?: { select?: boolean }) => {
    const tree = await api.post<Workspace>("/workspaces", { name });
    set((s) => ({ workspaces: [tree, ...s.workspaces] }));
    // `select: false` lets callers create a tree without switching to it — used
    // by the tree-in-tree "create & link" action so the current edit context is
    // preserved.
    if (options?.select !== false) {
      await get().selectTree(tree);
    }
    return tree;
  },

  // Jump back to an ancestor in the breadcrumb, dropping everything below it.
  navigateToTreeStack: async (index: number) => {
    const entry = get().workspaceNavStack[index];
    if (!entry) return;
    set((s) => ({ workspaceNavStack: s.workspaceNavStack.slice(0, index) }));
    await get().connect({ id: entry.id, name: entry.name });
  },

  renameTree: async (tree: Workspace, name: string) => {
    const updated = await api.patch<Workspace>(`/workspaces/${tree.id}`, {
      name,
    });
    set((s) => ({
      workspaces: s.workspaces.map((t) => (t.id === tree.id ? updated : t)),
      selectedTree: s.selectedTree?.id === tree.id ? updated : s.selectedTree,
    }));
  },

  updateTree: (tree: Workspace) => {
    set((s) => ({
      workspaces: s.workspaces.map((t) => (t.id === tree.id ? tree : t)),
      selectedTree: s.selectedTree?.id === tree.id ? tree : s.selectedTree,
    }));
  },

  deleteTree: async (tree: Workspace) => {
    await api.del(`/workspaces/${tree.id}`);
    const wasSelected = get().selectedTree?.id === tree.id;
    set((s) => ({
      workspaces: s.workspaces.filter((t) => t.id !== tree.id),
    }));
    if (wasSelected) await get().disconnect();
  },

  mergeTrees: async (
    name: string,
    sourceA: string,
    sourceB?: string,
    resolutions?: MergeResolution[],
  ) => {
    const { job_id } = await api.post<{ job_id: string }>("/workspaces/merge", {
      name,
      source_a: sourceA,
      source_b: sourceB ?? null,
      resolutions: resolutions ?? null,
    });
    const workspaceId = await useJobStore.getState().trackJob(job_id);
    const tree = await api.get<Workspace>(`/workspaces/${workspaceId}`);
    await get().loadTrees();
    await get().selectTree(tree);
    return tree;
  },

  fetchTreeMembers: async (workspaceId: string) => {
    const rows = await WorkspaceService.getMembers(workspaceId);
    return (rows as MemberDB[]).map((r) => mapMemberFromDB(r));
  },

  selectTree: async (tree: Workspace | undefined) => {
    treeRequestVersion += 1;
    // Picking a tree directly (e.g. from the database selector) resets the
    // tree-in-tree breadcrumb; only link-following keeps the ancestor chain.
    set({ workspaceNavStack: [] });
    if (!tree) {
      await get().disconnect();
      return;
    }
    set({ selectedTree: tree });
    await get().connect(tree);
  },

  connect: async (tree: Workspace) => {
    set({
      selectedTree: tree,
      isReady: false,
      metadata: {},
      relationTypes: [],
    });

    // Switching directly between workspaces does not go through disconnect(). Clear
    // every content store here so deferred views do not retain their previous
    // tree's data or initialized state while they wait for their first visit.
    clearDataStores();

    // Marks the tree as "opened" server-side and returns the latest role.
    try {
      const fresh = await api.get<Workspace>(`/workspaces/${tree.id}`);
      // A later selection or disconnect supersedes this request. Do not let
      // its response restore a stale tree after the newer transition wins.
      if (!isActiveTree(tree.id)) return;
      set((s) => ({
        selectedTree: fresh,
        // Update in place if already known, otherwise insert — this list can
        // be missing the tree entirely (opened via a link/notification before
        // the next loadTrees(), or re-opened right after a loadTrees() had
        // pruned it). Leaving it out here would connect successfully while
        // the tree selector (which only renders from this list) shows no
        // selection at all, since its value has no matching option.
        workspaces: s.workspaces.some((t) => t.id === fresh.id)
          ? s.workspaces.map((t) => (t.id === fresh.id ? fresh : t))
          : [fresh, ...s.workspaces],
      }));
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        // Access is truly gone (revoked mid-session, or the tree/view was
        // deleted) — don't limp along with the stale tree object and an
        // empty canvas. Tear down only when this tree is still the active
        // one (a concurrent SSE-triggered loadTrees may have disconnected
        // already), but always re-throw so the caller (notification click,
        // tree selector) can surface the failure instead of resolving into
        // a silent empty state (#813).
        if (isActiveTree(tree.id)) {
          await get().disconnect();
          // disconnect() just cleared `selectedTree`, so loadTrees()'s own
          // "was something selected before this refresh?" check can no
          // longer see it — refresh the lists, then land on a remaining
          // tree ourselves instead of leaving a blank canvas.
          // Fire-and-forget: the caller doesn't need to wait on this to see
          // the rejection below.
          void get()
            .loadTrees()
            .then(() => selectFallbackTree(get))
            .catch(() => {
              // Transient failure refreshing the list — the next SSE event
              // or heartbeat retries.
            });
        }
        throw error;
      }
      if (!isActiveTree(tree.id)) return;
      // transient (network hiccup, 5xx) — proceed with what we already have.
    }

    const loads = [
      get().refreshMetadata(tree.id),
      get().refreshRelationTypes(),
      useMemberStore.getState().refreshMembers(tree.id),
    ];
    await Promise.allSettled(loads);
    if (!isActiveTree(tree.id)) return;

    // Freshly created (or seeded) workspaces: every member sits at (0, 0)
    // because they've never been arranged. Auto-arrange on first open instead
    // of showing a pile of stacked nodes.
    const freshRole = get().selectedTree?.role;
    const canWrite = freshRole === "owner" || freshRole === "editor";
    if (canWrite) {
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

  refreshMetadata: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) return;
    const metadata = await api.get<DatabaseMetaData>(
      `/workspaces/${workspaceId}/metadata`,
    );
    if (!isActiveTree(workspaceId)) return;
    set({ metadata });
  },

  refreshRelationTypes: async () => {
    const types = await WorkspaceService.getRelationTypes();
    set({ relationTypes: types });
  },
}));

/** Convenience accessor used by the data stores. */
export const activeTreeId = (): string | undefined =>
  useWorkspaceStore.getState().selectedTree?.id;

/** Stale-write guard for async loaders: true if `workspaceId` is still the active tree. */
export const isActiveTree = (workspaceId: string | undefined): boolean =>
  workspaceId !== undefined && activeTreeId() === workspaceId;

export const resetTreeStoreForSession = () => {
  useWorkspaceStore.setState({
    workspaces: [],
    selectedTree: undefined,
    metadata: {},
    relationTypes: [],
    isReady: false,
    workspaceNavStack: [],
  });
  clearDataStores();
};
