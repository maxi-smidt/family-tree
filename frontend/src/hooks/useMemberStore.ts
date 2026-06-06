import { create } from "zustand";
import {
  mapMemberFromDB,
  Member,
  MemberUpdate,
  RelationType,
} from "@/types/member";
import {
  mapDiseaseFromDB,
  CarrierStatus,
  InheritancePattern,
} from "@/types/disease";
import { getLayoutedElements } from "@/utils/layoutUtils";
import { DatabaseService } from "@/services/DatabaseService";
import { activeTreeId } from "@/hooks/useDatabaseStore";

interface MemberState {
  members: Member[];
  refreshMembers: () => Promise<void>;
  addMember: (member: Member) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberPartial: (id: string, changes: MemberUpdate) => Promise<void>;
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
  addDisease: (
    memberId: string,
    name: string,
    carrierStatus: CarrierStatus,
    inheritancePattern: InheritancePattern,
    diagnosisDate: string | null,
    notes: string | null,
  ) => Promise<void>;
  updateDisease: (
    diseaseId: string,
    name: string,
    carrierStatus: CarrierStatus,
    inheritancePattern: InheritancePattern,
    diagnosisDate: string | null,
    notes: string | null,
  ) => Promise<void>;
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

    const result = await DatabaseService.getMembers(treeId);
    const relations = await DatabaseService.getRelations(treeId);
    const diseases = await DatabaseService.getDiseases(treeId);

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
      mapped.parents = {
        paternalParent: null,
        maternalParent: null,
      };

      memberRelations.forEach((r) => {
        if (r.relation_type === "parent") {
          const parentGender = memberGenderMap.get(r.to_member_id);
          if (parentGender === "m") {
            mapped.parents.paternalParent = r.to_member_id;
          } else if (parentGender === "f") {
            mapped.parents.maternalParent = r.to_member_id;
          } else {
            if (!mapped.parents.paternalParent)
              mapped.parents.paternalParent = r.to_member_id;
            else mapped.parents.maternalParent = r.to_member_id;
          }
        }
      });

      return mapped;
    });

    set({ members: appMembers });
  },

  addMember: async (newMember: Member) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await DatabaseService.addMember(treeId, newMember);

    if (newMember.parents.paternalParent) {
      await DatabaseService.addRelation(
        treeId,
        newMember.id,
        newMember.parents.paternalParent,
        "parent",
      );
    }
    if (newMember.parents.maternalParent) {
      await DatabaseService.addRelation(
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
        await DatabaseService.addRelation(
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
    await DatabaseService.removeMember(treeId, memberId);
    await get().refreshMembers();
  },

  updateMemberPartial: async (id: string, changes: MemberUpdate) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const { paternalParentId, maternalParentId, ...otherChanges } = changes;

    await DatabaseService.updateMember(treeId, id, otherChanges);

    const currentMember = get().members.find((m) => m.id === id);

    if (paternalParentId !== undefined) {
      const oldParent = currentMember?.parents.paternalParent;
      const newParent = paternalParentId;

      if (oldParent && oldParent !== newParent) {
        await DatabaseService.removeRelation(
          treeId,
          id,
          oldParent,
          "parent" as RelationType,
        );
      }
      if (newParent && newParent !== oldParent) {
        await DatabaseService.addRelation(
          treeId,
          id,
          newParent,
          "parent" as RelationType,
        );
      }
    }

    if (maternalParentId !== undefined) {
      const oldParent = currentMember?.parents.maternalParent;
      const newParent = maternalParentId;

      if (oldParent && oldParent !== newParent) {
        await DatabaseService.removeRelation(
          treeId,
          id,
          oldParent,
          "parent" as RelationType,
        );
      }
      if (newParent && newParent !== oldParent) {
        await DatabaseService.addRelation(
          treeId,
          id,
          newParent,
          "parent" as RelationType,
        );
      }
    }

    await get().refreshMembers();
  },

  updateLayout: async () => {
    const treeId = activeTreeId();
    const { members, refreshMembers } = get();
    if (!treeId) return;

    try {
      const newPositions = getLayoutedElements(members);

      const updatePromises = Object.entries(newPositions).map(([id, pos]) => {
        return DatabaseService.updateMemberPosition(treeId, id, pos.x, pos.y);
      });

      await Promise.all(updatePromises);
      await refreshMembers();
    } catch (error) {
      console.error("Failed to update layout:", error);
      await refreshMembers();
    }
  },

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await DatabaseService.addRelation(treeId, fromId, toId, type);
    await get().refreshMembers();
  },

  removeRelation: async (fromId: string, toId: string, type: RelationType) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await DatabaseService.removeRelation(treeId, fromId, toId, type);
    await get().refreshMembers();
  },

  addDisease: async (
    memberId: string,
    name: string,
    carrierStatus: CarrierStatus,
    inheritancePattern: InheritancePattern,
    diagnosisDate: string | null,
    notes: string | null,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    const id = crypto.randomUUID();
    await DatabaseService.addDisease(
      treeId,
      id,
      memberId,
      name,
      carrierStatus,
      inheritancePattern,
      diagnosisDate,
      notes,
    );
    await get().refreshMembers();
  },

  updateDisease: async (
    diseaseId: string,
    name: string,
    carrierStatus: CarrierStatus,
    inheritancePattern: InheritancePattern,
    diagnosisDate: string | null,
    notes: string | null,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await DatabaseService.updateDisease(
      treeId,
      diseaseId,
      name,
      carrierStatus,
      inheritancePattern,
      diagnosisDate,
      notes,
    );
    await get().refreshMembers();
  },

  removeDisease: async (diseaseId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await DatabaseService.removeDisease(treeId, diseaseId);
    await get().refreshMembers();
  },
}));
