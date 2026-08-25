import { create } from "zustand";
import {
  Member,
  MemberDB,
  MemberSearchHitDB,
  MemberUpdate,
  RelationDB,
  RelationType,
} from "@/types/member";
import { mapDiseaseFromDB, DiseaseDB, DiseaseInput } from "@/types/disease";
import { mapMembersFromRows } from "@/utils/memberMapping";
import { treeProcessorClient } from "@/workers/treeProcessorClient";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree, isVirtualId } from "@/hooks/useWorkspaceStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { invalidateDerivedViews } from "@/hooks/invalidateDerivedViews";
import i18n from "@/i18n/i18n";
import { toast } from "sonner";
import {
  applyCollapsedState,
  applyPositionState,
  captureCollapsedState,
  capturePositions,
} from "@/hooks/memberStoreLayout";

const WINDOWED_MODE_THRESHOLD = 2_000;

// Bumped on every refreshMembers() call so a slower earlier fetch (e.g. a
// focus change superseded by another before it returns) cannot overwrite the
// members a later call already committed.
let memberRefreshVersion = 0;

// New-member creation still has its own relationship setup flow. Existing
// member edits use the atomic member PATCH endpoint instead.
async function syncVitalEventAfterCreate(
  memberId: string,
  eventType: "birth" | "death",
  date: string,
  location: string | null,
) {
  const { events, addEvent, updateEvent } = useEventStore.getState();
  const existing = events.find(
    (event) =>
      event.eventType === eventType && event.linkedMemberIds.includes(memberId),
  );
  if (!existing) {
    await addEvent([memberId], { eventType, date, location });
  } else if (existing.date !== date) {
    await updateEvent(
      existing.id,
      {
        eventType,
        date,
        location: existing.location,
        description: existing.description,
      },
      [memberId],
    );
  }
}

interface HistoryEntry {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 50;
const MEMBER_DELETE_GRACE_MS = 8000;

interface PendingMemberDeletion {
  workspaceId: string;
  member: Member;
  originalIndex: number;
  timeoutId: ReturnType<typeof setTimeout>;
  toastId?: string | number;
  status: "pending" | "committing";
}

const pendingMemberDeletions = new Map<string, PendingMemberDeletion>();

function pendingDeletionKey(workspaceId: string, memberId: string) {
  return `${workspaceId}:${memberId}`;
}

function restorePendingMember(pending: PendingMemberDeletion) {
  if (!isActiveTree(pending.workspaceId)) return;

  useMemberStore.setState((state) => {
    if (state.members.some((member) => member.id === pending.member.id)) {
      return {};
    }

    const members = [...state.members];
    members.splice(
      Math.min(pending.originalIndex, members.length),
      0,
      pending.member,
    );
    return { members };
  });
}

function undoPendingMemberDeletion(key: string) {
  const pending = pendingMemberDeletions.get(key);
  if (!pending || pending.status !== "pending") return;

  clearTimeout(pending.timeoutId);
  pendingMemberDeletions.delete(key);
  if (pending.toastId !== undefined) {
    toast.dismiss(pending.toastId);
  }
  restorePendingMember(pending);
}

async function commitPendingMemberDeletion(key: string) {
  const pending = pendingMemberDeletions.get(key);
  if (!pending || pending.status !== "pending") return;

  pending.status = "committing";
  if (pending.toastId !== undefined) {
    toast.dismiss(pending.toastId);
  }
  try {
    await WorkspaceService.removeMember(pending.workspaceId, pending.member.id);
  } catch {
    pendingMemberDeletions.delete(key);
    restorePendingMember(pending);
    toast.error(i18n.t("hooks.member-store.delete-error"));
    return;
  }

  pendingMemberDeletions.delete(key);
  if (isActiveTree(pending.workspaceId)) {
    await refreshAfterOptimisticFailure(
      useMemberStore.getState().refreshMembers,
      pending.workspaceId,
    );
    invalidateDerivedViews();
  }
}

// Drop any member with a pending optimistic deletion for this tree.
function filterPendingDeletions(members: Member[], workspaceId: string): Member[] {
  return members.filter(
    (member) =>
      !pendingMemberDeletions.has(pendingDeletionKey(workspaceId, member.id)),
  );
}

// Synchronously map raw rows into Member[], dropping any member with a pending
// optimistic deletion. Used for bounded datasets (windowed neighborhood loads),
// where the synchronous map is cheap. For potentially large full loads use
// buildAppMembersOffThread instead.
function buildAppMembers(
  memberRows: MemberDB[],
  relations: RelationDB[],
  workspaceId: string,
): Member[] {
  return filterPendingDeletions(
    mapMembersFromRows(memberRows, relations),
    workspaceId,
  );
}

// Like buildAppMembers, but maps potentially large row sets off the main thread
// via the tree-processor worker (falling back to synchronous mapping if it is
// unavailable). Used by the non-windowed full-load paths where the row count can
// be sizeable. Because it awaits the worker, callers MUST re-check isActiveTree
// after it resolves before committing the result to the store.
async function buildAppMembersOffThread(
  memberRows: MemberDB[],
  relations: RelationDB[],
  workspaceId: string,
): Promise<Member[]> {
  let mapped: Member[];
  try {
    mapped = await treeProcessorClient.parseMembers(
      workspaceId,
      memberRows,
      relations,
    );
  } catch {
    mapped = mapMembersFromRows(memberRows, relations);
  }
  return filterPendingDeletions(mapped, workspaceId);
}

async function refreshAfterOptimisticFailure(
  refreshMembers: (workspaceId?: string) => Promise<void>,
  workspaceId: string,
) {
  try {
    await refreshMembers(workspaceId);
  } catch (error) {
    console.error("Failed to refresh members after optimistic write:", error);
    toast.error(i18n.t("hooks.member-store.refresh-error"));
  }
}

interface MemberState {
  members: Member[];
  detailLoadedIds: Set<string>;
  windowed: boolean;
  focusRootId: string | null;
  windowedForTreeId: string | null;
  neighborhoodUp: number;
  neighborhoodDown: number;
  neighborhoodTruncated: boolean;
  totalMemberCount: number;
  // One-shot request to center/highlight a member once it is present in
  // `members` — set when navigating into a linked tree so the view lands on
  // the counterpart (bridge person). Consumed and cleared by the canvas.
  pendingLocateMemberId: string | null;
  setPendingLocateMemberId: (id: string | null) => void;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  _pushHistory: (entry: HistoryEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  searchMembers: (
    workspaceId: string,
    query: string,
    limit?: number,
  ) => Promise<MemberDB[]>;
  searchOtherTrees: (
    query: string,
    excludeWorkspaceId?: string,
    perTreeLimit?: number,
    limit?: number,
  ) => Promise<MemberSearchHitDB[]>;
  refreshMembers: (workspaceId?: string) => Promise<void>;
  setFocusRoot: (rootId: string) => Promise<void>;
  setNeighborhoodDepth: (up: number, down: number) => Promise<void>;
  fetchMemberDetail: (
    id: string,
    force?: boolean,
  ) => Promise<Member | undefined>;
  clear: () => void;
  addMember: (member: Member) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberPartial: (
    id: string,
    changes: MemberUpdate,
    workspaceId?: string,
  ) => Promise<
    { bridgeSync?: "synced" | "skipped_no_access" | null } | undefined
  >;
  batchSetCollapsed: (
    updates: { id: string; isCollapsed: boolean }[],
  ) => Promise<void>;
  isLayouting: boolean;
  persistPositions: (
    positions: { id: string; x: number; y: number }[],
  ) => Promise<void>;
  updateLayout: () => Promise<void>;
  addRelation: (
    fromId: string,
    toId: string,
    type: RelationType,
  ) => Promise<void>;
  removeRelation: (
    fromId: string,
    toId: string,
    type: RelationType,
  ) => Promise<void>;
  removeRelationBidirectional: (
    idA: string,
    idB: string,
    type: RelationType,
  ) => Promise<void>;
  addDisease: (memberId: string, disease: DiseaseInput) => Promise<void>;
  updateDisease: (
    memberId: string,
    diseaseId: string,
    disease: DiseaseInput,
  ) => Promise<void>;
  removeDisease: (memberId: string, diseaseId: string) => Promise<void>;
}

export const useMemberStore = create<MemberState>((set, get) => ({
  members: [],
  detailLoadedIds: new Set<string>(),
  windowed: false,
  focusRootId: null,
  windowedForTreeId: null,
  neighborhoodUp: 3,
  neighborhoodDown: 3,
  neighborhoodTruncated: false,
  totalMemberCount: 0,
  pendingLocateMemberId: null,
  setPendingLocateMemberId: (id: string | null) =>
    set({ pendingLocateMemberId: id }),
  isLayouting: false,
  undoStack: [],
  redoStack: [],

  _pushHistory: (entry) => {
    const { undoStack } = get();
    set({
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), entry],
      redoStack: [],
    });
  },

  searchMembers: (workspaceId, query, limit) =>
    WorkspaceService.searchMembers(workspaceId, query, limit),

  searchOtherTrees: (query, excludeWorkspaceId, perTreeLimit, limit) =>
    WorkspaceService.searchOtherTrees(query, excludeWorkspaceId, perTreeLimit, limit),

  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    set({ undoStack: undoStack.slice(0, -1) });
    try {
      await entry.undo();
      set((s) => ({ redoStack: [...s.redoStack, entry] }));
      invalidateDerivedViews();
    } catch (e) {
      set((s) => ({ undoStack: [...s.undoStack, entry] }));
      throw e;
    }
  },

  redo: async () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    set({ redoStack: redoStack.slice(0, -1) });
    try {
      await entry.redo();
      set((s) => ({ undoStack: [...s.undoStack, entry] }));
      invalidateDerivedViews();
    } catch (e) {
      set((s) => ({ redoStack: [...s.redoStack, entry] }));
      throw e;
    }
  },

  refreshMembers: async (workspaceId = activeTreeId()) => {
    const version = ++memberRefreshVersion;
    const stale = () => !isActiveTree(workspaceId) || version !== memberRefreshVersion;

    if (!workspaceId) {
      set({
        members: [],
        detailLoadedIds: new Set<string>(),
        windowed: false,
        focusRootId: null,
      });
      return;
    }

    const {
      windowed,
      focusRootId,
      windowedForTreeId,
      neighborhoodUp,
      neighborhoodDown,
    } = get();

    // Windowed state is scoped to the tree it was created for. When switching
    // to a different tree, fall through to the full-load path so stale
    // focusRootIds from the previous tree don't poison the new load.
    const isWindowed = windowed && windowedForTreeId === workspaceId;

    if (isWindowed) {
      try {
        const nb = await WorkspaceService.getNeighborhood(
          workspaceId,
          focusRootId ?? undefined,
          neighborhoodUp,
          neighborhoodDown,
        );
        if (stale()) return;
        set({
          members: buildAppMembers(nb.members, nb.relations, workspaceId),
          detailLoadedIds: new Set<string>(),
          focusRootId: nb.root_id || null,
          neighborhoodTruncated: nb.truncated,
          totalMemberCount: nb.total_member_count,
        });
      } catch {
        // Transient error: leave existing members unchanged.
      }
      return;
    }

    // Clear any stale windowed state from a different tree before the full load.
    if (windowed && windowedForTreeId !== workspaceId) {
      set({ windowed: false, focusRootId: null, windowedForTreeId: null });
    }

    // Ask the bounded endpoint first — its total_member_count comes from an
    // indexed count query, not a full scan — so a large workspace is never
    // fetched in full just to discover it is large. Virtual views don't
    // expose this endpoint (it would 404), so skip straight to the full load.
    if (!isVirtualId(workspaceId)) {
      try {
        const nb = await WorkspaceService.getNeighborhood(
          workspaceId,
          undefined,
          neighborhoodUp,
          neighborhoodDown,
        );
        if (stale()) return;
        if (nb.total_member_count > WINDOWED_MODE_THRESHOLD) {
          set({
            windowed: true,
            windowedForTreeId: workspaceId,
            members: buildAppMembers(nb.members, nb.relations, workspaceId),
            detailLoadedIds: new Set<string>(),
            focusRootId: nb.root_id || null,
            neighborhoodTruncated: nb.truncated,
            totalMemberCount: nb.total_member_count,
          });
          return;
        }
      } catch {
        // Probe failed — fall through to the full load below, unless a newer
        // call has already superseded this one (no point starting an
        // O(workspace) fetch whose result would just be discarded).
        if (stale()) return;
      }
    }

    // Small/medium workspace (or the probe above didn't resolve): full load,
    // mapped off the main thread (worker) so the UI never blocks.
    const [membersResult, relationsResult] = await Promise.allSettled([
      WorkspaceService.getMembers(workspaceId, true),
      WorkspaceService.getRelations(workspaceId),
    ]);

    if (
      membersResult.status === "rejected" ||
      relationsResult.status === "rejected"
    ) {
      return;
    }

    if (stale()) return;

    const memberRows = membersResult.value;
    const relations = relationsResult.value;

    const appMembers = await buildAppMembersOffThread(
      memberRows,
      relations,
      workspaceId,
    );
    if (stale()) return;
    set({
      windowed: false,
      windowedForTreeId: null,
      members: appMembers,
      detailLoadedIds: new Set<string>(),
      totalMemberCount: memberRows.length,
    });
  },

  setFocusRoot: async (rootId: string) => {
    const workspaceId = activeTreeId();
    set({
      windowed: true,
      focusRootId: rootId,
      windowedForTreeId: workspaceId ?? null,
    });
    await get().refreshMembers();
  },

  setNeighborhoodDepth: async (up: number, down: number) => {
    set({ neighborhoodUp: up, neighborhoodDown: down });
    await get().refreshMembers();
  },

  fetchMemberDetail: async (id: string, force = false) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return undefined;

    // Virtual view members: treat as already loaded — return surface data from store
    if (isVirtualId(workspaceId)) {
      return get().members.find((m) => m.id === id);
    }

    // Cache hit: skip network round-trip when detail is already loaded and not forced
    if (!force && get().detailLoadedIds.has(id)) {
      return get().members.find((m) => m.id === id);
    }

    let detailRow: MemberDB;
    let diseases: DiseaseDB[];

    try {
      const [detailResult, diseasesResult] = await Promise.allSettled([
        WorkspaceService.getMember(workspaceId, id),
        WorkspaceService.getDiseases(workspaceId),
      ]);

      if (detailResult.status === "rejected") {
        // If the detail fetch fails, return the existing surface member from the store
        return get().members.find((m) => m.id === id);
      }
      detailRow = detailResult.value;
      diseases =
        diseasesResult.status === "fulfilled" ? diseasesResult.value : [];
    } catch {
      // On unexpected failure, return the existing surface member from the store
      return get().members.find((m) => m.id === id);
    }

    const memberDiseases = diseases
      .filter((d) => d.member_id === id)
      .map(mapDiseaseFromDB);

    // Merge detail fields into the existing store member (preserve relations/parents/position)
    const existing = get().members.find((m) => m.id === id);
    if (!existing) return undefined;

    const merged: Member = {
      ...existing,
      additionalData: detailRow.additionalData ?? null,
      birthplace: detailRow.birthplace ?? null,
      hometown: detailRow.hometown ?? null,
      cemetery: detailRow.cemetery ?? null,
      placesLived: detailRow.placesLived
        ? (() => {
            try {
              const parsed = JSON.parse(detailRow.placesLived);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
        : [],
      diseases: memberDiseases,
    };

    set((state) => ({
      members: state.members.map((m) => (m.id === id ? merged : m)),
      detailLoadedIds: new Set([...state.detailLoadedIds, id]),
    }));

    return merged;
  },

  clear: () =>
    set({
      members: [],
      detailLoadedIds: new Set<string>(),
      windowed: false,
      focusRootId: null,
      windowedForTreeId: null,
      neighborhoodTruncated: false,
      totalMemberCount: 0,
      pendingLocateMemberId: null,
      undoStack: [],
      redoStack: [],
    }),

  addMember: async (newMember: Member) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.addMember(workspaceId, newMember);

    if (newMember.parents.paternalParent) {
      await WorkspaceService.addRelation(
        workspaceId,
        newMember.id,
        newMember.parents.paternalParent,
        "parent",
      );
    }
    if (newMember.parents.maternalParent) {
      await WorkspaceService.addRelation(
        workspaceId,
        newMember.id,
        newMember.parents.maternalParent,
        "parent",
      );
    }

    if (newMember.relations) {
      for (const rel of newMember.relations) {
        if (
          rel.relationType === "parent" &&
          (rel.toMemberId === newMember.parents.paternalParent ||
            rel.toMemberId === newMember.parents.maternalParent)
        ) {
          continue;
        }
        await WorkspaceService.addRelation(
          workspaceId,
          newMember.id,
          rel.toMemberId,
          rel.relationType,
        );
      }
    }

    await get().refreshMembers(workspaceId);
    invalidateDerivedViews();

    if (newMember.date.birth) {
      await syncVitalEventAfterCreate(
        newMember.id,
        "birth",
        newMember.date.birth,
        newMember.birthplace,
      );
    }
    if (newMember.date.death) {
      await syncVitalEventAfterCreate(
        newMember.id,
        "death",
        newMember.date.death,
        newMember.cemetery,
      );
    }

    const captured = newMember;
    get()._pushHistory({
      undo: async () => {
        await WorkspaceService.removeMember(workspaceId, captured.id);
        await get().refreshMembers(workspaceId);
      },
      redo: async () => {
        await WorkspaceService.addMember(workspaceId, captured);
        if (captured.parents.paternalParent) {
          await WorkspaceService.addRelation(
            workspaceId,
            captured.id,
            captured.parents.paternalParent,
            "parent",
          );
        }
        if (captured.parents.maternalParent) {
          await WorkspaceService.addRelation(
            workspaceId,
            captured.id,
            captured.parents.maternalParent,
            "parent",
          );
        }
        if (captured.relations) {
          for (const rel of captured.relations) {
            if (
              rel.relationType === "parent" &&
              (rel.toMemberId === captured.parents.paternalParent ||
                rel.toMemberId === captured.parents.maternalParent)
            ) {
              continue;
            }
            await WorkspaceService.addRelation(
              workspaceId,
              captured.id,
              rel.toMemberId,
              rel.relationType,
            );
          }
        }
        await get().refreshMembers(workspaceId);
      },
    });
  },

  removeMember: async (memberId: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    const originalIndex = get().members.findIndex((m) => m.id === memberId);
    const captured = get().members[originalIndex];
    if (!captured) return;

    const key = pendingDeletionKey(workspaceId, memberId);
    if (pendingMemberDeletions.has(key)) return;

    set((state) => ({
      members: state.members.filter((member) => member.id !== memberId),
      redoStack: [],
    }));

    const pending: PendingMemberDeletion = {
      workspaceId,
      member: captured,
      originalIndex,
      timeoutId: setTimeout(() => {
        void commitPendingMemberDeletion(key);
      }, MEMBER_DELETE_GRACE_MS),
      status: "pending",
    };
    pendingMemberDeletions.set(key, pending);

    pending.toastId = toast.info(i18n.t("hooks.member-store.delete-pending"), {
      duration: MEMBER_DELETE_GRACE_MS,
      action: {
        label: i18n.t("hooks.member-store.undo-delete"),
        onClick: () => undoPendingMemberDeletion(key),
      },
    });
  },

  updateMemberPartial: async (
    id: string,
    changes: MemberUpdate,
    requestedTreeId?: string,
  ) => {
    const workspaceId = requestedTreeId ?? activeTreeId();
    if (!workspaceId) return;

    const currentMember = get().members.find((m) => m.id === id);
    const updated = await WorkspaceService.updateMember(workspaceId, id, changes);
    // Transient outcome of the bridge-person mirror — surfaced to callers so
    // the member form can tell the editor when the counterpart didn't follow.
    const result = { bridgeSync: updated?.bridgeSync ?? null };

    await get().refreshMembers(workspaceId);
    if (isActiveTree(workspaceId)) invalidateDerivedViews();
    if ("imageData" in changes && isActiveTree(workspaceId))
      useStorageStore.getState().refreshStorageUsage();

    if (!currentMember) return result;

    const previous: MemberUpdate = {
      gender: currentMember.gender,
      academicTitle: currentMember.academicTitle,
      firstName: currentMember.firstName,
      middleNames: currentMember.middleNames,
      baptismalName: currentMember.baptismalName,
      lastName: currentMember.lastName,
      maidenName: currentMember.maidenName,
      imageData: currentMember.imageData ?? undefined,
      dateOfBirth: currentMember.date.birth,
      dateOfDeath: currentMember.date.death,
      deceased: currentMember.deceased,
      adopted: currentMember.adopted,
      paternalParentId: currentMember.parents.paternalParent,
      maternalParentId: currentMember.parents.maternalParent,
      additionalData: currentMember.additionalData,
      birthplace: currentMember.birthplace,
      hometown: currentMember.hometown,
      cemetery: currentMember.cemetery,
      placesLived:
        currentMember.placesLived.length > 0
          ? JSON.stringify(currentMember.placesLived)
          : null,
      isCollapsed: currentMember.isCollapsed,
      positionX: currentMember.position.x,
      positionY: currentMember.position.y,
      linkedWorkspaceId: currentMember.linkedWorkspaceId ?? null,
    };
    const reverseChanges: MemberUpdate = {};
    for (const key of Object.keys(changes) as (keyof MemberUpdate)[]) {
      reverseChanges[key] = previous[key] as never;
    }

    const restore = async (update: MemberUpdate) => {
      await WorkspaceService.updateMember(workspaceId, id, update);
      await get().refreshMembers(workspaceId);
      if (isActiveTree(workspaceId)) invalidateDerivedViews();
    };

    get()._pushHistory({
      undo: async () => {
        await restore(reverseChanges);
      },
      redo: async () => {
        await restore(changes);
      },
    });
    return result;
  },

  // Persist collapse/expand state for many members in one request and reflect
  // locally — no full refetch needed since only isCollapsed changed.
  batchSetCollapsed: async (updates) => {
    const workspaceId = activeTreeId();
    if (!workspaceId || updates.length === 0) return;

    const previous = captureCollapsedState(get().members, updates);
    set({ members: applyCollapsedState(get().members, updates) });

    try {
      await WorkspaceService.updateMemberCollapsedBulk(workspaceId, updates);
    } catch (error) {
      if (isActiveTree(workspaceId)) {
        set({ members: applyCollapsedState(get().members, previous) });
        toast.error(i18n.t("tree-view.persistence.collapse-error"));
        await refreshAfterOptimisticFailure(get().refreshMembers, workspaceId);
      }
      throw error;
    }
  },

  // Persist node positions (drag / re-layout) in one request and reflect them
  // locally, instead of re-fetching the whole tree — only coordinates changed.
  persistPositions: async (positions) => {
    const workspaceId = activeTreeId();
    if (!workspaceId || positions.length === 0) return;

    const oldPositions = capturePositions(get().members, positions);
    set({ members: applyPositionState(get().members, positions) });

    try {
      await WorkspaceService.updateMemberPositions(
        workspaceId,
        positions.map((p) => ({ id: p.id, positionX: p.x, positionY: p.y })),
      );
    } catch (error) {
      if (isActiveTree(workspaceId)) {
        set({ members: applyPositionState(get().members, oldPositions) });
        toast.error(i18n.t("tree-view.persistence.positions-error"));
        await refreshAfterOptimisticFailure(get().refreshMembers, workspaceId);
      }
      throw error;
    }

    // Virtual view positions are stored in VirtualViewPosition, not source
    // workspaces — they're independent. But position moves have no undo history.
    if (isVirtualId(workspaceId)) return;

    get()._pushHistory({
      undo: async () => {
        set({ members: applyPositionState(get().members, oldPositions) });
        try {
          await WorkspaceService.updateMemberPositions(
            workspaceId,
            oldPositions.map((p) => ({
              id: p.id,
              positionX: p.x,
              positionY: p.y,
            })),
          );
        } catch (error) {
          if (isActiveTree(workspaceId)) {
            set({ members: applyPositionState(get().members, positions) });
            toast.error(i18n.t("tree-view.persistence.positions-error"));
            await refreshAfterOptimisticFailure(get().refreshMembers, workspaceId);
          }
          throw error;
        }
      },
      redo: async () => {
        set({ members: applyPositionState(get().members, positions) });
        try {
          await WorkspaceService.updateMemberPositions(
            workspaceId,
            positions.map((p) => ({
              id: p.id,
              positionX: p.x,
              positionY: p.y,
            })),
          );
        } catch (error) {
          if (isActiveTree(workspaceId)) {
            set({ members: applyPositionState(get().members, oldPositions) });
            toast.error(i18n.t("tree-view.persistence.positions-error"));
            await refreshAfterOptimisticFailure(get().refreshMembers, workspaceId);
          }
          throw error;
        }
      },
    });
  },

  updateLayout: async () => {
    const workspaceId = activeTreeId();
    const { members, refreshMembers, persistPositions } = get();
    if (!workspaceId) return;

    set({ isLayouting: true });
    try {
      const newPositions = await treeProcessorClient.computeLayout(
        workspaceId,
        members,
      );
      await persistPositions(
        Object.entries(newPositions).map(([id, pos]) => ({
          id,
          x: pos.x,
          y: pos.y,
        })),
      );
    } catch (error) {
      console.error("Failed to update layout:", error);
      toast.error(i18n.t("hooks.member-store.layout-error"));
      await refreshMembers(workspaceId);
    } finally {
      set({ isLayouting: false });
    }
  },

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.addRelation(workspaceId, fromId, toId, type);
    await get().refreshMembers(workspaceId);
    invalidateDerivedViews();

    get()._pushHistory({
      undo: async () => {
        await WorkspaceService.removeRelation(workspaceId, fromId, toId, type);
        await get().refreshMembers(workspaceId);
      },
      redo: async () => {
        await WorkspaceService.addRelation(workspaceId, fromId, toId, type);
        await get().refreshMembers(workspaceId);
      },
    });
  },

  removeRelation: async (fromId: string, toId: string, type: RelationType) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.removeRelation(workspaceId, fromId, toId, type);
    await get().refreshMembers(workspaceId);
    invalidateDerivedViews();

    get()._pushHistory({
      undo: async () => {
        await WorkspaceService.addRelation(workspaceId, fromId, toId, type);
        await get().refreshMembers(workspaceId);
      },
      redo: async () => {
        await WorkspaceService.removeRelation(workspaceId, fromId, toId, type);
        await get().refreshMembers(workspaceId);
      },
    });
  },

  // Remove a couple/sibling link, which is stored as up to two directional
  // rows. Deleting them as two separate removeRelation calls would each run a
  // full refresh, and the worker re-derives the edge from the surviving row
  // between them — so the edge flashes back for one frame before vanishing.
  // Delete both directions together, then refresh exactly once.
  removeRelationBidirectional: async (
    idA: string,
    idB: string,
    type: RelationType,
  ) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    // Capture which directions actually exist so we delete (and undo) exactly
    // those — a link may be stored in one or both directions.
    const members = get().members;
    const hasForward = !!members
      .find((m) => m.id === idA)
      ?.relations?.some((r) => r.toMemberId === idB && r.relationType === type);
    const hasBackward = !!members
      .find((m) => m.id === idB)
      ?.relations?.some((r) => r.toMemberId === idA && r.relationType === type);

    if (!hasForward && !hasBackward) return;

    const removeBoth = () =>
      Promise.all([
        hasForward
          ? WorkspaceService.removeRelation(workspaceId, idA, idB, type)
          : Promise.resolve(),
        hasBackward
          ? WorkspaceService.removeRelation(workspaceId, idB, idA, type)
          : Promise.resolve(),
      ]);
    const addBoth = () =>
      Promise.all([
        hasForward
          ? WorkspaceService.addRelation(workspaceId, idA, idB, type)
          : Promise.resolve(),
        hasBackward
          ? WorkspaceService.addRelation(workspaceId, idB, idA, type)
          : Promise.resolve(),
      ]);

    await removeBoth();
    await get().refreshMembers(workspaceId);
    invalidateDerivedViews();

    get()._pushHistory({
      undo: async () => {
        await addBoth();
        await get().refreshMembers(workspaceId);
      },
      redo: async () => {
        await removeBoth();
        await get().refreshMembers(workspaceId);
      },
    });
  },

  addDisease: async (memberId: string, disease: DiseaseInput) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    const id = crypto.randomUUID();
    await WorkspaceService.addDisease(workspaceId, id, memberId, disease);
    await get().fetchMemberDetail(memberId, true);
    invalidateDerivedViews();
  },

  updateDisease: async (
    memberId: string,
    diseaseId: string,
    disease: DiseaseInput,
  ) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.updateDisease(workspaceId, diseaseId, disease);
    await get().fetchMemberDetail(memberId, true);
    invalidateDerivedViews();
  },

  removeDisease: async (memberId: string, diseaseId: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.removeDisease(workspaceId, diseaseId);
    await get().fetchMemberDetail(memberId, true);
    invalidateDerivedViews();
  },
}));
