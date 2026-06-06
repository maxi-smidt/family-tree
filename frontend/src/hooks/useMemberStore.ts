import { create } from "zustand";
import {
  mapMemberFromDB,
  Member,
  MemberUpdate,
  RelationType,
} from "@/types/member";
import { mapDiseaseFromDB, DiseaseInput } from "@/types/disease";
import { getLayoutedElements } from "@/utils/layoutUtils";
import { reconstructParents } from "@/utils/memberUtils";
import { TreeService } from "@/services/TreeService";
import { activeTreeId } from "@/hooks/useTreeStore";

interface MemberState {
  members: Member[];
  refreshMembers: () => Promise<void>;
  addMember: (member: Member) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberPartial: (id: string, changes: MemberUpdate) => Promise<void>;
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
  updateDisease: (diseaseId: string, disease: DiseaseInput) => Promise<void>;
  removeDisease: (diseaseId: string) => Promise<void>;
}

export const useMemberStore = create<MemberState>((set, get) => ({
  members: [],

  refreshMembers: async () => {
    const treeId = activeTreeId();
    if (!treeId) {
      set({ members: [] });
      return;
    }

    const [result, relations, diseases] = await Promise.all([
      TreeService.getMembers(treeId),
      TreeService.getRelations(treeId),
      TreeService.getDiseases(treeId),
    ]);

    const memberGenderMap = new Map<string, string>();
    result.forEach((m) => memberGenderMap.set(m.id, m.gender));

    const appMembers = result.map((member) => {
      const memberRelations = relations.filter(
        (r) => r.from_member_id === member.id,
      );
      const memberDiseases = diseases
        .filter((d) => d.member_id === member.id)
        .map(mapDiseaseFromDB);

      const mapped = mapMemberFromDB(member, memberRelations, memberDiseases);

      // Reconstruct parents from relations
      mapped.parents = reconstructParents(
        memberRelations.filter((r) => r.relation_type === "parent"),
        memberGenderMap,
      );

      return mapped;
    });

    set({ members: appMembers });
  },

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

    await get().refreshMembers();
  },

  removeMember: async (memberId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeMember(treeId, memberId);
    await get().refreshMembers();
  },

  updateMemberPartial: async (id: string, changes: MemberUpdate) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const { paternalParentId, maternalParentId, ...otherChanges } = changes;

    await TreeService.updateMember(treeId, id, otherChanges);

    const currentMember = get().members.find((m) => m.id === id);

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

    await get().refreshMembers();
  },

  // Persist node positions (drag / re-layout) in one request and reflect them
  // locally, instead of re-fetching the whole tree — only coordinates changed.
  persistPositions: async (positions) => {
    const treeId = activeTreeId();
    if (!treeId || positions.length === 0) return;

    const byId = new Map(positions.map((p) => [p.id, p]));
    set({
      members: get().members.map((m) => {
        const p = byId.get(m.id);
        return p ? { ...m, position: { x: p.x, y: p.y } } : m;
      }),
    });

    await TreeService.updateMemberPositions(
      treeId,
      positions.map((p) => ({ id: p.id, positionX: p.x, positionY: p.y })),
    );
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
      await refreshMembers();
    }
  },

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.addRelation(treeId, fromId, toId, type);
    await get().refreshMembers();
  },

  removeRelation: async (fromId: string, toId: string, type: RelationType) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeRelation(treeId, fromId, toId, type);
    await get().refreshMembers();
  },

  addDisease: async (memberId: string, disease: DiseaseInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    const id = crypto.randomUUID();
    await TreeService.addDisease(treeId, id, memberId, disease);
    await get().refreshMembers();
  },

  updateDisease: async (diseaseId: string, disease: DiseaseInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.updateDisease(treeId, diseaseId, disease);
    await get().refreshMembers();
  },

  removeDisease: async (diseaseId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeDisease(treeId, diseaseId);
    await get().refreshMembers();
  },
}));
