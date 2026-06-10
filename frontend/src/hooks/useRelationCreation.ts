import { useState } from "react";
import { Connection } from "@xyflow/react";
import { RelationType } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";

export const useRelationCreation = () => {
  const { members, addRelation, removeRelation } = useMemberStore();
  const { visibleRelationTypes, toggleRelationType } = useFamilyTreeSettings();

  const [newRelation, setNewRelation] = useState<Connection | null>(null);
  const [pendingHorizontalRelation, setPendingHorizontalRelation] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);

  const isDialogOpen = !!newRelation || !!pendingHorizontalRelation;

  const closeDialog = () => {
    setNewRelation(null);
    setPendingHorizontalRelation(null);
  };

  const startHorizontalRelation = (sourceId: string, targetId: string) => {
    setPendingHorizontalRelation({ sourceId, targetId });
  };

  const confirmRelation = (type: RelationType) => {
    if (newRelation) {
      const fromId = newRelation.source;
      const toId = newRelation.target;

      const sourceMember = members.find((m) => m.id === fromId);
      const forwardRel = sourceMember?.relations?.find(
        (r) => r.toMemberId === toId && r.relationType !== "parent",
      );
      if (forwardRel) {
        void removeRelation(fromId, toId, forwardRel.relationType);
      }

      const targetMember = members.find((m) => m.id === toId);
      const backwardRel = targetMember?.relations?.find(
        (r) => r.toMemberId === fromId && r.relationType !== "parent",
      );
      if (backwardRel) {
        void removeRelation(toId, fromId, backwardRel.relationType);
      }

      void addRelation(fromId, toId, type);
      if (!visibleRelationTypes.includes(type)) {
        toggleRelationType(type);
      }
    } else if (pendingHorizontalRelation) {
      const { sourceId, targetId } = pendingHorizontalRelation;
      void addRelation(sourceId, targetId, type);
      if (!visibleRelationTypes.includes(type)) {
        toggleRelationType(type);
      }
    }

    setNewRelation(null);
    setPendingHorizontalRelation(null);
  };

  return {
    newRelation,
    setNewRelation,
    pendingHorizontalRelation,
    startHorizontalRelation,
    isDialogOpen,
    closeDialog,
    confirmRelation,
  };
};
