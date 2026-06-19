import { create } from "zustand";
import {
  mapMemberFromDB,
  Member,
  MemberDB,
  MemberUpdate,
  RelationDB,
  RelationType,
} from "@/types/member";
import { mapDiseaseFromDB, DiseaseDB, DiseaseInput } from "@/types/disease";
import { getLayoutedElements } from "@/utils/layoutUtils";
import { reconstructParents } from "@/utils/memberUtils";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree, isVirtualId } from "@/hooks/useTreeStore";
import { useEventStore } from "@/hooks/useEventStore";
import i18n from "@/i18n/i18n";
import { toast } from "sonner";

type CollapseUpdate = { id: string; isCollapsed: boolean };
type PositionUpdate = { id: string; x: number; y: number };

async function syncVitalEvent(
  memberId: string,
  eventType: "birth" | "death",
  newDate: string | null | undefined,
  _oldDate: string | null | undefined,
) {
  const { events, addEvent, updateEvent, removeEvent } =
    useEventStore.getState();
  const existing = events.find(
    (e) => e.eventType === eventType && e.linkedMemberIds.includes(memberId),
  );

  if (newDate) {
    if (existing && existing.date !== newDate) {
      await updateEvent(existing.id, { eventType, date: newDate }, [memberId]);
    } else if (!existing) {
      await addEvent([memberId], { eventType, date: newDate });
    }
  } else if (!newDate && existing) {
    await removeEvent(existing.id);
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
  }
}

function applyCollapsedState(members: Member[], updates: CollapseUpdate[]) {
  const byId = new Map(updates.map((u) => [u.id, u.isCollapsed]));
  return members.map((m) => {
    const collapsed = byId.get(m.id);
    return collapsed !== undefined ? { ...m, isCollapsed: collapsed } : m;
  });
}

function applyPositionState(members: Member[], positions: PositionUpdate[]) {
  const byId = new Map(positions.map((p) => [p.id, p]));
  return members.map((m) => {
    const position = byId.get(m.id);
    return position ? { ...m, position: { x: position.x, y: position.y } } : m;
  });
}

function captureCollapsedState(members: Member[], updates: CollapseUpdate[]) {
  return updates.flatMap((u) => {
    const existing = members.find((m) => m.id === u.id);
    return existing ? [{ id: u.id, isCollapsed: existing.isCollapsed }] : [];
  });
}

function capturePositions(members: Member[], positions: PositionUpdate[]) {
  return positions.flatMap((p) => {
    const existing = members.find((m) => m.id === p.id);
    return existing
      ? [{ id: p.id, x: existing.position.x, y: existing.position.y }]
      : [];
  });
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
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  _pushHistory: (entry: HistoryEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  refreshMembers: (treeId?: string) => Promise<void>;
  fetchMemberDetail: (
    id: string,
    force?: boolean,
  ) => Promise<Member | undefined>;
  clear: () => void;
  addMember: (member: Member) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberPartial: (id: string, changes: MemberUpdate) => Promise<void>;
  batchSetCollapsed: (
    updates: { id: string; isCollapsed: boolean }[],
  ) => Promise<void>;
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
  undoStack: [],
  redoStack: [],

  _pushHistory: (entry) => {
    const { undoStack } = get();
    set({
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), entry],
      redoStack: [],
    });
  },

  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    set({ undoStack: undoStack.slice(0, -1) });
    try {
      await entry.undo();
      set((s) => ({ redoStack: [...s.redoStack, entry] }));
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
    } catch (e) {
      set((s) => ({ redoStack: [...s.redoStack, entry] }));
      throw e;
    }
  },

  refreshMembers: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ members: [], detailLoadedIds: new Set<string>() });
      return;
    }

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
    const result = membersResult.value;
    const relations = relationsResult.value;

    if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight — drop stale data

    const memberGenderMap = new Map<string, string>();
    result.forEach((m) => memberGenderMap.set(m.id, m.gender ?? "o"));

    const relationsByMember = new Map<string, RelationDB[]>();
    for (const r of relations) {
      relationsByMember.set(
        r.from_member_id,
        (relationsByMember.get(r.from_member_id) ?? []).concat(r),
      );
    }

    const appMembers = result
      .map((member) => {
        const memberRelations = relationsByMember.get(member.id) ?? [];

        const mapped = mapMemberFromDB(member, memberRelations, []);

        // Reconstruct parents from relations
        mapped.parents = reconstructParents(
          memberRelations.filter((r) => r.relation_type === "parent"),
          memberGenderMap,
        );

        return mapped;
      })
      .filter(
        (member) =>
          !pendingMemberDeletions.has(pendingDeletionKey(treeId, member.id)),
      );

    set({ members: appMembers, detailLoadedIds: new Set<string>() });
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
      additionalData: detailRow.additional_data ?? null,
      birthplace: detailRow.birthplace ?? null,
      hometown: detailRow.hometown ?? null,
      placesLived: detailRow.places_lived
        ? (() => {
            try {
              const parsed = JSON.parse(detailRow.places_lived);
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

    if (newMember.date.birth) {
      await syncVitalEvent(newMember.id, "birth", newMember.date.birth, null);
    }
    if (newMember.date.death) {
      await syncVitalEvent(newMember.id, "death", newMember.date.death, null);
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

  updateMemberPartial: async (id: string, changes: MemberUpdate) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const currentMember = get().members.find((m) => m.id === id);

    const { paternalParentId, maternalParentId, ...otherChanges } = changes;

    await TreeService.updateMember(treeId, id, otherChanges);

    // Re-point one parent slot: drop the previous "parent" relation (if it
    // changed) and add the new one. A no-op when old and new are the same.
    const syncParentSlot = async (
      oldParent: string | null | undefined,
      newParent: string | null,
    ) => {
      if (oldParent && oldParent !== newParent) {
        await TreeService.removeRelation(
          treeId,
          id,
          oldParent,
          "parent" as RelationType,
        );
      }
      if (newParent && newParent !== oldParent) {
        await TreeService.addRelation(
          treeId,
          id,
          newParent,
          "parent" as RelationType,
        );
      }
    };

    if (paternalParentId !== undefined) {
      await syncParentSlot(
        currentMember?.parents.paternalParent,
        paternalParentId,
      );
    }
    if (maternalParentId !== undefined) {
      await syncParentSlot(
        currentMember?.parents.maternalParent,
        maternalParentId,
      );
    }

    await get().refreshMembers(treeId);

    if ("dateOfBirth" in changes) {
      await syncVitalEvent(
        id,
        "birth",
        changes.dateOfBirth,
        currentMember?.date.birth,
      );
    }
    if ("dateOfDeath" in changes) {
      await syncVitalEvent(
        id,
        "death",
        changes.dateOfDeath ?? null,
        currentMember?.date.death ?? null,
      );
    }

    if (!currentMember) return;

    const oldPaternal = currentMember.parents.paternalParent;
    const oldMaternal = currentMember.parents.maternalParent;

    const reverseChanges: Omit<
      MemberUpdate,
      "paternalParentId" | "maternalParentId"
    > = {};
    if ("gender" in otherChanges) reverseChanges.gender = currentMember.gender;
    if ("firstName" in otherChanges)
      reverseChanges.firstName = currentMember.firstName;
    if ("lastName" in otherChanges)
      reverseChanges.lastName = currentMember.lastName;
    if ("maidenName" in otherChanges)
      reverseChanges.maidenName = currentMember.maidenName;
    if ("imageData" in otherChanges)
      reverseChanges.imageData = currentMember.imageData ?? undefined;
    if ("dateOfBirth" in otherChanges)
      reverseChanges.dateOfBirth = currentMember.date.birth;
    if ("dateOfDeath" in otherChanges)
      reverseChanges.dateOfDeath = currentMember.date.death;
    if ("additionalData" in otherChanges)
      reverseChanges.additionalData = currentMember.additionalData;
    if ("isCollapsed" in otherChanges)
      reverseChanges.isCollapsed = currentMember.isCollapsed;
    if ("positionX" in otherChanges)
      reverseChanges.positionX = currentMember.position.x;
    if ("positionY" in otherChanges)
      reverseChanges.positionY = currentMember.position.y;

    get()._pushHistory({
      undo: async () => {
        await TreeService.updateMember(treeId, id, reverseChanges);
        if (paternalParentId !== undefined) {
          await syncParentSlot(paternalParentId, oldPaternal);
        }
        if (maternalParentId !== undefined) {
          await syncParentSlot(maternalParentId, oldMaternal);
        }
        await get().refreshMembers(treeId);
      },
      redo: async () => {
        await TreeService.updateMember(treeId, id, otherChanges);
        if (paternalParentId !== undefined) {
          await syncParentSlot(oldPaternal, paternalParentId);
        }
        if (maternalParentId !== undefined) {
          await syncParentSlot(oldMaternal, maternalParentId);
        }
        await get().refreshMembers(treeId);
      },
    });
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

    try {
      const newPositions = getLayoutedElements(members);
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
    }
  },

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.addRelation(treeId, fromId, toId, type);
    await get().refreshMembers(treeId);

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

  addDisease: async (memberId: string, disease: DiseaseInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    const id = crypto.randomUUID();
    await TreeService.addDisease(treeId, id, memberId, disease);
    await get().fetchMemberDetail(memberId, true);
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
  },

  removeDisease: async (memberId: string, diseaseId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeDisease(treeId, diseaseId);
    await get().fetchMemberDetail(memberId, true);
  },
}));
