import { create } from "zustand";
import {
  SubtreeExtractPayload,
  SubtreeExtractPreview,
  Workspace,
} from "@/types/workspace";
import { ApiError, api, setPublicTreeToken } from "@/services/api";
import { WorkspaceService } from "@/services/WorkspaceService";
import { WorkspaceSharingService } from "@/services/WorkspaceSharingService";
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
import { clearTaskStore } from "@/hooks/taskStoreRegistry";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useStorageStore } from "@/hooks/useStorageStore";
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
interface WorkspaceNavEntry {
  id: string;
  name: string;
}

interface DatabaseState {
  workspaces: Workspace[];
  virtualViews: Workspace[];
  selectedTree: Workspace | undefined;
  metadata: DatabaseMetaData;
  relationTypes: RelationTypeDB[];
  isReady: boolean;
  // Ancestor chain for the tree-in-tree feature: the workspaces the user came from
  // when following member→tree links. Empty when viewing a top-level tree.
  workspaceNavStack: WorkspaceNavEntry[];

  loadTrees: () => Promise<void>;
  openTreeById: (workspaceId: string) => Promise<Workspace>;
  openTreeAndLocateMember: (workspaceId: string, memberId: string) => Promise<void>;
  unlockPublicTree: (workspaceId: string, password: string) => Promise<Workspace>;
  createTree: (name: string, options?: { select?: boolean }) => Promise<Workspace>;
  openLinkedTree: (
    workspaceId: string,
    focusMemberId?: string | null,
  ) => Promise<void>;
  createLinkedSubtree: (memberId: string, name: string) => Promise<Workspace>;
  linkExistingTree: (
    memberId: string,
    body: {
      linked_workspace_id: string;
      mode: "existing" | "create";
      counterpart_member_id?: string | null;
      field_choices?: Partial<Record<string, MergeFieldChoice>>;
    },
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
  extractSubtree: (payload: SubtreeExtractPayload) => Promise<Workspace>;
  extractSubtreePreview: (
    payload: Omit<SubtreeExtractPayload, "name">,
  ) => Promise<SubtreeExtractPreview>;
  fetchTreeMembers: (workspaceId: string) => Promise<Member[]>;
  createVirtualView: (name: string, sourceWorkspaceIds: string[]) => Promise<Workspace>;
  renameVirtualView: (view: Workspace, name: string) => Promise<void>;
  updateVirtualViewSources: (
    view: Workspace,
    sourceWorkspaceIds: string[],
  ) => Promise<void>;
  deleteVirtualView: (view: Workspace) => Promise<void>;
  recomputeMatches: (
    view: Workspace,
  ) => Promise<{ groupCount: number; mergedMemberCount: number }>;
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
};

// Land on the most recently used remaining tree/view (the API sorts by
// last_opened — same rule as startup in App.tsx) instead of leaving a blank
// canvas, when nothing is currently selected. Shared by loadTrees() and
// connect()'s revoked-access recovery — both disconnect first (for an
// immediate, deterministic UI reset), which clears `selectedTree` before this
// runs, so it must read the *current* workspaces/virtualViews rather than rely on
// the stale selection that triggered the disconnect. Best effort: if the
// fallback tree fails to open, stay disconnected.
const selectFallbackTree = async (get: () => DatabaseState) => {
  if (get().selectedTree) return;
  const { workspaces, virtualViews } = get();
  const next = [...workspaces, ...virtualViews][0];
  if (next) {
    await get()
      .selectTree(next)
      .catch(() => {});
  }
};

export const useWorkspaceStore = create<DatabaseState>((set, get) => ({
  workspaces: [],
  virtualViews: [],
  selectedTree: undefined,
  metadata: {},
  relationTypes: [],
  isReady: false,
  workspaceNavStack: [],

  loadTrees: async () => {
    const [workspaces, virtualViews] = await Promise.all([
      api.get<Workspace[]>("/workspaces"),
      WorkspaceService.listVirtualViews().catch(() => [] as Workspace[]),
    ]);
    set({ workspaces, virtualViews });
    // Drop a stale selection that no longer exists / is no longer accessible.
    const selected = get().selectedTree;
    const allItems = [...workspaces, ...virtualViews];
    if (!selected) return;
    const freshSelected = allItems.find((t) => t.id === selected.id);
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
  openTreeById: async (workspaceId: string) => {
    const requestVersion = ++treeRequestVersion;
    const tree = await api.get<Workspace>(`/workspaces/${workspaceId}`);
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

  unlockPublicTree: async (workspaceId: string, password: string) => {
    const { token } = await WorkspaceSharingService.unlockPublicTree(
      workspaceId,
      password,
    );
    setPublicTreeToken(token);
    return get().openTreeById(workspaceId);
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

  // Follow a member→tree link: remember where we came from (breadcrumb), verify
  // the target is accessible, then switch to it. Throws if the linked tree is
  // missing or the user has no access, so callers can surface a message.
  // When the link carries a counterpart member (the bridge person's row in the
  // target tree), the canvas centers on it after the switch.
  openLinkedTree: async (workspaceId: string, focusMemberId?: string | null) => {
    const current = get().selectedTree;
    if (!current || current.id === workspaceId) return;
    const target = await api.get<Workspace>(`/workspaces/${workspaceId}`);
    // Following a back-link to where we just came from behaves like "back":
    // pop the breadcrumb instead of growing it (A → B → A stays two levels).
    const stack = get().workspaceNavStack;
    const last = stack[stack.length - 1];
    if (last && last.id === workspaceId) {
      set({ workspaceNavStack: stack.slice(0, -1) });
    } else {
      set({
        workspaceNavStack: [...stack, { id: current.id, name: current.name }],
      });
    }
    await get().connect(target);
    if (focusMemberId) {
      // Set after connect: the tree switch clears the member store, and the
      // canvas consumes this once the counterpart is present in `members`.
      useMemberStore.getState().setPendingLocateMemberId(focusMemberId);
    }
  },

  // Workspace-in-tree "create & link": one atomic backend call creates the new
  // tree, seeds it with a copy of the member (the bridge person) and links
  // the two rows bidirectionally. The current tree stays selected; the
  // updated anchor is reflected into the member store so the badge appears.
  createLinkedSubtree: async (memberId: string, name: string) => {
    const current = get().selectedTree;
    if (!current) throw new Error("No tree selected");
    const res = await WorkspaceService.createMemberSubtree(
      current.id,
      memberId,
      name,
    );
    set((s) => ({ workspaces: [res.workspace, ...s.workspaces] }));
    useMemberStore.setState((s) => ({
      members: s.members.map((m) =>
        m.id === memberId
          ? {
              ...m,
              linkedWorkspaceId: res.anchor.linkedWorkspaceId ?? null,
              linkedMemberId: res.anchor.linkedMemberId ?? null,
            }
          : m,
      ),
    }));
    return res.workspace;
  },

  // Workspace-in-tree "link existing tree": resolves a bridge person against an
  // already-existing target tree — either an existing member the caller
  // asserts is the same person, or a fresh copy seeded into the target. The
  // current tree stays selected; the updated anchor is reflected into the
  // member store so the badge appears immediately.
  linkExistingTree: async (memberId, body) => {
    const current = get().selectedTree;
    if (!current) throw new Error("No tree selected");
    const res = await WorkspaceService.linkMemberToTree(current.id, memberId, body);
    set((s) => ({
      workspaces: s.workspaces.some((t) => t.id === res.workspace.id)
        ? s.workspaces
        : [res.workspace, ...s.workspaces],
    }));
    useMemberStore.setState((s) => ({
      members: s.members.map((m) =>
        m.id === memberId
          ? {
              ...m,
              linkedWorkspaceId: res.anchor.linkedWorkspaceId ?? null,
              linkedMemberId: res.anchor.linkedMemberId ?? null,
            }
          : m,
      ),
    }));
    return res.workspace;
  },

  // Jump back to an ancestor in the breadcrumb, dropping everything below it.
  navigateToTreeStack: async (index: number) => {
    const entry = get().workspaceNavStack[index];
    if (!entry) return;
    set((s) => ({ workspaceNavStack: s.workspaceNavStack.slice(0, index) }));
    await get().connect({ id: entry.id, name: entry.name });
  },

  renameTree: async (tree: Workspace, name: string) => {
    const updated = await api.patch<Workspace>(`/workspaces/${tree.id}`, { name });
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

  extractSubtree: async (payload) => {
    const { job_id } = await WorkspaceService.extractSubtree(payload);
    const workspaceId = await useJobStore.getState().trackJob(job_id);
    const tree = await api.get<Workspace>(`/workspaces/${workspaceId}`);
    await get().loadTrees();
    await get().selectTree(tree);
    return tree;
  },

  extractSubtreePreview: async (payload) => {
    return WorkspaceService.previewSubtree(payload);
  },

  fetchTreeMembers: async (workspaceId: string) => {
    const rows = await WorkspaceService.getMembers(workspaceId);
    return (rows as MemberDB[]).map((r) => mapMemberFromDB(r));
  },

  createVirtualView: async (name: string, sourceWorkspaceIds: string[]) => {
    const view = await WorkspaceService.createVirtualView(name, sourceWorkspaceIds);
    set((s) => ({ virtualViews: [view, ...s.virtualViews] }));
    await get().selectTree(view);
    return view;
  },

  renameVirtualView: async (view: Workspace, name: string) => {
    const updated = await WorkspaceService.updateVirtualView(view.id, { name });
    set((s) => ({
      virtualViews: s.virtualViews.map((v) => (v.id === view.id ? updated : v)),
      selectedTree: s.selectedTree?.id === view.id ? updated : s.selectedTree,
    }));
  },

  updateVirtualViewSources: async (view: Workspace, sourceWorkspaceIds: string[]) => {
    const updated = await WorkspaceService.updateVirtualView(view.id, {
      source_workspace_ids: sourceWorkspaceIds,
    });
    set((s) => ({
      virtualViews: s.virtualViews.map((v) => (v.id === view.id ? updated : v)),
      selectedTree: s.selectedTree?.id === view.id ? updated : s.selectedTree,
    }));
  },

  deleteVirtualView: async (view: Workspace) => {
    await WorkspaceService.deleteVirtualView(view.id);
    const wasSelected = get().selectedTree?.id === view.id;
    set((s) => ({
      virtualViews: s.virtualViews.filter((v) => v.id !== view.id),
    }));
    if (wasSelected) {
      // Fall back to another tree (or remaining view) instead of leaving the
      // app in the "no database" state.
      const { workspaces, virtualViews } = get();
      const next = workspaces[0] ?? virtualViews[0];
      if (next) await get().selectTree(next);
      else await get().disconnect();
    }
  },

  recomputeMatches: async (view: Workspace) => {
    const result = await WorkspaceService.recomputeVirtualViewMatches(view.id);
    const workspaceId = get().selectedTree?.id;
    if (workspaceId === view.id) {
      await useMemberStore.getState().refreshMembers(workspaceId);
      await get().refreshMetadata(workspaceId);
    }
    return result;
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

    const virtual = isVirtualId(tree.id);

    // Marks the tree/view as "opened" server-side and returns the latest
    // role + (for views) the resolved source list.
    try {
      const fresh = await api.get<Workspace>(
        virtual ? `/virtual-views/${tree.id}` : `/workspaces/${tree.id}`,
      );
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
        workspaces: virtual
          ? s.workspaces
          : s.workspaces.some((t) => t.id === fresh.id)
            ? s.workspaces.map((t) => (t.id === fresh.id ? fresh : t))
            : [fresh, ...s.workspaces],
        virtualViews: virtual
          ? s.virtualViews.some((v) => v.id === fresh.id)
            ? s.virtualViews.map((v) => (v.id === fresh.id ? fresh : v))
            : [fresh, ...s.virtualViews]
          : s.virtualViews,
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

    // Virtual workspaces are read-only composites: auto-arrange the layout only
    // until the user saves an alignment overlay, then respect it.
    if (virtual && get().metadata.hasLayout !== true) {
      await useMemberStore.getState().updateLayout();
    }

    // Freshly extracted (or seeded) workspaces: every member sits at (0, 0)
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

  refreshMetadata: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) return;
    const basePath = isVirtualId(workspaceId)
      ? `/virtual-views/${workspaceId}`
      : `/workspaces/${workspaceId}`;
    const metadata = await api.get<DatabaseMetaData>(`${basePath}/metadata`);
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
    virtualViews: [],
    selectedTree: undefined,
    metadata: {},
    relationTypes: [],
    isReady: false,
    workspaceNavStack: [],
  });
  clearDataStores();
};
