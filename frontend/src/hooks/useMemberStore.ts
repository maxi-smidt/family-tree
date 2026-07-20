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
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree, isVirtualId } from "@/hooks/useTreeStore";
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
  treeId: string;
  member: Member;
  originalIndex: number;
  timeoutId: ReturnType<typeof setTimeout>;
  toastId?: string | number;
  status: "pending" | "committing";
}

const pendingMemberDeletions = new Map<string, PendingMemberDeletion>();

function pendingDeletionKey(treeId: string, memberId: string) {
  return `${treeId}:${memberId}`;
}

function restorePendingMember(pending: PendingMemberDeletion) {
  if (!isActiveTree(pending.treeId)) return;

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
    await TreeService.removeMember(pending.treeId, pending.member.id);
  } catch {
    pendingMemberDeletions.delete(key);
    restorePendingMember(pending);
    toast.error(i18n.t("hooks.member-store.delete-error"));
    return;
  }

  pendingMemberDeletions.delete(key);
  if (isActiveTree(pending.treeId)) {
    await refreshAfterOptimisticFailure(
      useMemberStore.getState().refreshMembers,
      pending.treeId,
    );
    invalidateDerivedViews();
  }
}

// Drop any member with a pending optimistic deletion for this tree.
function filterPendingDeletions(members: Member[], treeId: string): Member[] {
  return members.filter(
    (member) =>
      !pendingMemberDeletions.has(pendingDeletionKey(treeId, member.id)),
  );
}

// Synchronously map raw rows into Member[], dropping any member with a pending
// optimistic deletion. Used for bounded datasets (windowed neighborhood loads),
// where the synchronous map is cheap. For potentially large full loads use
// buildAppMembersOffThread instead.
function buildAppMembers(
  memberRows: MemberDB[],
  relations: RelationDB[],
  treeId: string,
): Member[] {
  return filterPendingDeletions(
    mapMembersFromRows(memberRows, relations),
    treeId,
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
  treeId: string,
): Promise<Member[]> {
  let mapped: Member[];
  try {
    mapped = await treeProcessorClient.parseMembers(
      treeId,
      memberRows,
      relations,
    );
  } catch {
    mapped = mapMembersFromRows(memberRows, relations);
  }
  return filterPendingDeletions(mapped, treeId);
}

async function refreshAfterOptimisticFailure(
  refreshMembers: (treeId?: string) => Promise<void>,
  treeId: string,
) {
  try {
    await refreshMembers(treeId);
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
    treeId: string,
    query: string,
    limit?: number,
  ) => Promise<MemberDB[]>;
  searchOtherTrees: (
    query: string,
    excludeTreeId?: string,
    perTreeLimit?: number,
    limit?: number,
  ) => Promise<MemberSearchHitDB[]>;
  refreshMembers: (treeId?: string) => Promise<void>;
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
    treeId?: string,
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

  searchMembers: (treeId, query, limit) =>
    TreeService.searchMembers(treeId, query, limit),

  searchOtherTrees: (query, excludeTreeId, perTreeLimit, limit) =>
    TreeService.searchOtherTrees(query, excludeTreeId, perTreeLimit, limit),

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

  refreshMembers: async (treeId = activeTreeId()) => {
    if (!treeId) {
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
    const isWindowed = windowed && windowedForTreeId === treeId;

    if (isWindowed) {
      try {
        const nb = await TreeService.getNeighborhood(
          treeId,
          focusRootId ?? undefined,
          neighborhoodUp,
          neighborhoodDown,
        );
        if (!isActiveTree(treeId)) return;
        set({
          members: buildAppMembers(nb.members, nb.relations, treeId),
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
    if (windowed && windowedForTreeId !== treeId) {
      set({ windowed: false, focusRootId: null, windowedForTreeId: null });
    }

    // Normal mode: full load
    const [membersResult, relationsResult] = await Promise.allSettled([
      TreeService.getMembers(treeId, true),
      TreeService.getRelations(treeId),
    ]);

    if (
      membersResult.status === "rejected" ||
      relationsResult.status === "rejected"
    ) {
      return;
    }

    if (!isActiveTree(treeId)) return;

    const memberRows = membersResult.value;
    const relations = relationsResult.value;

    // Virtual views don't expose the neighborhood/search endpoints, so never
    // auto-enter windowed mode for them — it would 404 and fall back to a full
    // load anyway. Real trees over the threshold switch to the windowed view.
    if (memberRows.length > WINDOWED_MODE_THRESHOLD && !isVirtualId(treeId)) {
      // Auto-enter windowed mode: load neighborhood with default root
      set({
        windowed: true,
        windowedForTreeId: treeId,
        totalMemberCount: memberRows.length,
      });
      try {
        const nb = await TreeService.getNeighborhood(
          treeId,
          undefined,
          neighborhoodUp,
          neighborhoodDown,
        );
        if (!isActiveTree(treeId)) return;
        set({
          members: buildAppMembers(nb.members, nb.relations, treeId),
          detailLoadedIds: new Set<string>(),
          focusRootId: nb.root_id || null,
          neighborhoodTruncated: nb.truncated,
          totalMemberCount: nb.total_member_count,
        });
      } catch {
        // Neighborhood load failed — fall back to the full dataset without
        // windowed UI, mapped off the main thread since it can be large.
        const appMembers = await buildAppMembersOffThread(
          memberRows,
          relations,
          treeId,
        );
        if (!isActiveTree(treeId)) return;
        set({
          windowed: false,
          windowedForTreeId: null,
          members: appMembers,
          detailLoadedIds: new Set<string>(),
          totalMemberCount: memberRows.length,
        });
      }
      return;
    }

    // Normal mode: full load. Map off the main thread (worker) for large
    // datasets so the UI never blocks; falls back to synchronous mapping.
    const appMembers = await buildAppMembersOffThread(
      memberRows,
      relations,
      treeId,
    );
    if (!isActiveTree(treeId)) return;
    set({
      members: appMembers,
      detailLoadedIds: new Set<string>(),
      totalMemberCount: memberRows.length,
    });
  },

  setFocusRoot: async (rootId: string) => {
    const treeId = activeTreeId();
    set({
      windowed: true,
      focusRootId: rootId,
      windowedForTreeId: treeId ?? null,
    });
    await get().refreshMembers();
  },

  setNeighborhoodDepth: async (up: number, down: number) => {
    set({ neighborhoodUp: up, neighborhoodDown: down });
    await get().refreshMembers();
  },

  fetchMemberDetail: async (id: string, force = false) => {
    const treeId = activeTreeId();
    if (!treeId) return undefined;

    // Virtual view members: treat as already loaded — return surface data from store
    if (isVirtualId(treeId)) {
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
        TreeService.getMember(treeId, id),
        TreeService.getDiseases(treeId),
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
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.addMember(treeId, newMember);

    if (newMember.parents.paternalParent) {
      await TreeService.addRelation(
        treeId,
        newMember.id,
        newMember.parents.paternalParent,
        "parent",
      );
    }
    if (newMember.parents.maternalParent) {
      await TreeService.addRelation(
        treeId,
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
        await TreeService.addRelation(
          treeId,
          newMember.id,
          rel.toMemberId,
          rel.relationType,
        );
      }
    }

    await get().refreshMembers(treeId);
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
        await TreeService.removeMember(treeId, captured.id);
        await get().refreshMembers(treeId);
      },
      redo: async () => {
        await TreeService.addMember(treeId, captured);
        if (captured.parents.paternalParent) {
          await TreeService.addRelation(
            treeId,
            captured.id,
            captured.parents.paternalParent,
            "parent",
          );
        }
        if (captured.parents.maternalParent) {
          await TreeService.addRelation(
            treeId,
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
            await TreeService.addRelation(
              treeId,
              captured.id,
              rel.toMemberId,
              rel.relationType,
            );
          }
        }
        await get().refreshMembers(treeId);
      },
    });
  },

  removeMember: async (memberId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const originalIndex = get().members.findIndex((m) => m.id === memberId);
    const captured = get().members[originalIndex];
    if (!captured) return;

    const key = pendingDeletionKey(treeId, memberId);
    if (pendingMemberDeletions.has(key)) return;

    set((state) => ({
      members: state.members.filter((member) => member.id !== memberId),
      redoStack: [],
    }));

    const pending: PendingMemberDeletion = {
      treeId,
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
    const treeId = requestedTreeId ?? activeTreeId();
    if (!treeId) return;

    const currentMember = get().members.find((m) => m.id === id);
    const updated = await TreeService.updateMember(treeId, id, changes);
    // Transient outcome of the bridge-person mirror — surfaced to callers so
    // the member form can tell the editor when the counterpart didn't follow.
    const result = { bridgeSync: updated?.bridgeSync ?? null };

    await get().refreshMembers(treeId);
    if (isActiveTree(treeId)) invalidateDerivedViews();
    if ("imageData" in changes && isActiveTree(treeId))
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
      linkedTreeId: currentMember.linkedTreeId ?? null,
    };
    const reverseChanges: MemberUpdate = {};
    for (const key of Object.keys(changes) as (keyof MemberUpdate)[]) {
      reverseChanges[key] = previous[key] as never;
    }

    const restore = async (update: MemberUpdate) => {
      await TreeService.updateMember(treeId, id, update);
      await get().refreshMembers(treeId);
      if (isActiveTree(treeId)) invalidateDerivedViews();
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
    const treeId = activeTreeId();
    if (!treeId || updates.length === 0) return;

    const previous = captureCollapsedState(get().members, updates);
    set({ members: applyCollapsedState(get().members, updates) });

    try {
      await TreeService.updateMemberCollapsedBulk(treeId, updates);
    } catch (error) {
      if (isActiveTree(treeId)) {
        set({ members: applyCollapsedState(get().members, previous) });
        toast.error(i18n.t("tree-view.persistence.collapse-error"));
        await refreshAfterOptimisticFailure(get().refreshMembers, treeId);
      }
      throw error;
    }
  },

  // Persist node positions (drag / re-layout) in one request and reflect them
  // locally, instead of re-fetching the whole tree — only coordinates changed.
  persistPositions: async (positions) => {
    const treeId = activeTreeId();
    if (!treeId || positions.length === 0) return;

    const oldPositions = capturePositions(get().members, positions);
    set({ members: applyPositionState(get().members, positions) });

    try {
      await TreeService.updateMemberPositions(
        treeId,
        positions.map((p) => ({ id: p.id, positionX: p.x, positionY: p.y })),
      );
    } catch (error) {
      if (isActiveTree(treeId)) {
        set({ members: applyPositionState(get().members, oldPositions) });
        toast.error(i18n.t("tree-view.persistence.positions-error"));
        await refreshAfterOptimisticFailure(get().refreshMembers, treeId);
      }
      throw error;
    }

    // Virtual view positions are stored in VirtualViewPosition, not source
    // trees — they're independent. But position moves have no undo history.
    if (isVirtualId(treeId)) return;

    get()._pushHistory({
      undo: async () => {
        set({ members: applyPositionState(get().members, oldPositions) });
        try {
          await TreeService.updateMemberPositions(
            treeId,
            oldPositions.map((p) => ({
              id: p.id,
              positionX: p.x,
              positionY: p.y,
            })),
          );
        } catch (error) {
          if (isActiveTree(treeId)) {
            set({ members: applyPositionState(get().members, positions) });
            toast.error(i18n.t("tree-view.persistence.positions-error"));
            await refreshAfterOptimisticFailure(get().refreshMembers, treeId);
          }
          throw error;
        }
      },
      redo: async () => {
        set({ members: applyPositionState(get().members, positions) });
        try {
          await TreeService.updateMemberPositions(
            treeId,
            positions.map((p) => ({
              id: p.id,
              positionX: p.x,
              positionY: p.y,
            })),
          );
        } catch (error) {
          if (isActiveTree(treeId)) {
            set({ members: applyPositionState(get().members, oldPositions) });
            toast.error(i18n.t("tree-view.persistence.positions-error"));
            await refreshAfterOptimisticFailure(get().refreshMembers, treeId);
          }
          throw error;
        }
      },
    });
  },

  updateLayout: async () => {
    const treeId = activeTreeId();
    const { members, refreshMembers, persistPositions } = get();
    if (!treeId) return;

    set({ isLayouting: true });
    try {
      const newPositions = await treeProcessorClient.computeLayout(
        treeId,
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
      await refreshMembers(treeId);
    } finally {
      set({ isLayouting: false });
    }
  },

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.addRelation(treeId, fromId, toId, type);
    await get().refreshMembers(treeId);
    invalidateDerivedViews();

    get()._pushHistory({
      undo: async () => {
        await TreeService.removeRelation(treeId, fromId, toId, type);
        await get().refreshMembers(treeId);
      },
      redo: async () => {
        await TreeService.addRelation(treeId, fromId, toId, type);
        await get().refreshMembers(treeId);
      },
    });
  },

  removeRelation: async (fromId: string, toId: string, type: RelationType) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeRelation(treeId, fromId, toId, type);
    await get().refreshMembers(treeId);
    invalidateDerivedViews();

    get()._pushHistory({
      undo: async () => {
        await TreeService.addRelation(treeId, fromId, toId, type);
        await get().refreshMembers(treeId);
      },
      redo: async () => {
        await TreeService.removeRelation(treeId, fromId, toId, type);
        await get().refreshMembers(treeId);
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
    const treeId = activeTreeId();
    if (!treeId) return;

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
          ? TreeService.removeRelation(treeId, idA, idB, type)
          : Promise.resolve(),
        hasBackward
          ? TreeService.removeRelation(treeId, idB, idA, type)
          : Promise.resolve(),
      ]);
    const addBoth = () =>
      Promise.all([
        hasForward
          ? TreeService.addRelation(treeId, idA, idB, type)
          : Promise.resolve(),
        hasBackward
          ? TreeService.addRelation(treeId, idB, idA, type)
          : Promise.resolve(),
      ]);

    await removeBoth();
    await get().refreshMembers(treeId);
    invalidateDerivedViews();

    get()._pushHistory({
      undo: async () => {
        await addBoth();
        await get().refreshMembers(treeId);
      },
      redo: async () => {
        await removeBoth();
        await get().refreshMembers(treeId);
      },
    });
  },

  addDisease: async (memberId: string, disease: DiseaseInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    const id = crypto.randomUUID();
    await TreeService.addDisease(treeId, id, memberId, disease);
    await get().fetchMemberDetail(memberId, true);
    invalidateDerivedViews();
  },

  updateDisease: async (
    memberId: string,
    diseaseId: string,
    disease: DiseaseInput,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.updateDisease(treeId, diseaseId, disease);
    await get().fetchMemberDetail(memberId, true);
    invalidateDerivedViews();
  },

  removeDisease: async (memberId: string, diseaseId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeDisease(treeId, diseaseId);
    await get().fetchMemberDetail(memberId, true);
    invalidateDerivedViews();
  },
}));
