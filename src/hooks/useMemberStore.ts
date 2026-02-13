import { create } from "zustand";
import {
  mapMemberFromDB,
  Member,
  MemberUpdate,
  RelationType,
} from "@/types/member";
import { getLayoutedElements } from "@/utils/layoutUtils";
import { DatabaseService } from "@/services/DatabaseService";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";

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
}

export const useMemberStore = create<MemberState>((set, get) => ({
  members: [],

  refreshMembers: async () => {
    const db = useDatabaseStore.getState().db;
    if (!db) {
      set({ members: [] });
      return;
    }

    const result = await DatabaseService.getMembers(db);
    const relations = await DatabaseService.getRelations(db);

    const memberGenderMap = new Map<string, string>();
    result.forEach((m) => memberGenderMap.set(m.id, m.gender));

    const appMembers = result.map((member) => {
      const memberRelations = relations.filter(
        (r) => r.from_member_id === member.id,
      );
      const mapped = mapMemberFromDB(member, memberRelations);

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
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    await DatabaseService.addMember(db, newMember);

    if (newMember.parents.paternalParent) {
      await DatabaseService.addRelation(
        db,
        newMember.id,
        newMember.parents.paternalParent,
        "parent",
      );
    }
    if (newMember.parents.maternalParent) {
      await DatabaseService.addRelation(
        db,
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
          db,
          newMember.id,
          rel.toMemberId,
          rel.relationType,
        );
      }
    }

    await get().refreshMembers();
  },

  removeMember: async (memberId: string) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;
    await DatabaseService.removeMember(db, memberId);
    await get().refreshMembers();
  },

  updateMemberPartial: async (id: string, changes: MemberUpdate) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const { paternalParentId, maternalParentId, ...otherChanges } = changes;

    await DatabaseService.updateMember(db, id, otherChanges);

    const currentMember = get().members.find((m) => m.id === id);

    if (paternalParentId !== undefined) {
      const oldParent = currentMember?.parents.paternalParent;
      const newParent = paternalParentId;

      if (oldParent && oldParent !== newParent) {
        await DatabaseService.removeRelation(
          db,
          id,
          oldParent,
          "parent" as RelationType,
        );
      }
      if (newParent && newParent !== oldParent) {
        await DatabaseService.addRelation(
          db,
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
          db,
          id,
          oldParent,
          "parent" as RelationType,
        );
      }
      if (newParent && newParent !== oldParent) {
        await DatabaseService.addRelation(
          db,
          id,
          newParent,
          "parent" as RelationType,
        );
      }
    }

    await get().refreshMembers();
  },

  updateLayout: async () => {
    const db = useDatabaseStore.getState().db;
    const { members, refreshMembers } = get();
    if (!db) return;

    const newPositions = getLayoutedElements(members);

    const updatePromises = Object.entries(newPositions).map(([id, pos]) => {
      return DatabaseService.updateMemberPosition(db, id, pos.x, pos.y);
    });

    await Promise.all(updatePromises);

    await refreshMembers();
  },

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;
    await DatabaseService.addRelation(db, fromId, toId, type);
    await get().refreshMembers();
  },

  removeRelation: async (fromId: string, toId: string, type: RelationType) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;
    await DatabaseService.removeRelation(db, fromId, toId, type);
    await get().refreshMembers();
  },
}));
