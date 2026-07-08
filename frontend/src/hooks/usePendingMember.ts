import { useMemo, useState } from "react";
import { createMember, Member } from "@/types/member";
import {
  PendingRelation,
  nextMemberPosition,
} from "@/utils/pendingMemberUtils";
import { useMemberStore } from "@/hooks/useMemberStore";

interface UsePendingMemberOptions {
  onHorizontalRelationReady: (sourceId: string, targetId: string) => void;
}

export const usePendingMember = ({
  onHorizontalRelationReady,
}: UsePendingMemberOptions) => {
  const { members, addMember, addRelation } = useMemberStore();

  const [pendingNewMember, setPendingNewMember] = useState<Member | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isNewMemberSession, setIsNewMemberSession] = useState(false);
  const [pendingRelation, setPendingRelation] =
    useState<PendingRelation | null>(null);
  const [pendingHorizontalSourceId, setPendingHorizontalSourceId] = useState<
    string | null
  >(null);

  const editingMember = useMemo(
    () =>
      pendingNewMember && editingMemberId === pendingNewMember.id
        ? pendingNewMember
        : members.find((m) => m.id === editingMemberId) || null,
    [members, editingMemberId, pendingNewMember],
  );

  const onAddChild = (parentId: string) => {
    const parent = members.find((m) => m.id === parentId);
    if (!parent) return;

    const newMember = createMember(
      nextMemberPosition(parent.position, "child"),
    );
    setPendingNewMember(newMember);
    setPendingRelation({ type: "child-of", parentId });
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  const onAddChildToUnion = (parent1Id: string, parent2Id: string) => {
    const p1 = members.find((m) => m.id === parent1Id);
    const p2 = members.find((m) => m.id === parent2Id);
    if (!p1 || !p2) return;
    const midpoint = {
      x: (p1.position.x + p2.position.x) / 2,
      y: (p1.position.y + p2.position.y) / 2,
    };
    const newMember = createMember(nextMemberPosition(midpoint, "child"));
    setPendingNewMember(newMember);
    setPendingRelation({ type: "child-of-union", parent1Id, parent2Id });
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  const onAddParent = (childId: string) => {
    const child = members.find((m) => m.id === childId);
    if (!child) return;

    const newMember = createMember(
      nextMemberPosition(child.position, "parent"),
    );
    setPendingNewMember(newMember);
    setPendingRelation({ type: "parent-of", childId });
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  const onAddHorizontal = (memberId: string, side: "left" | "right") => {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;

    const placement = side === "left" ? "left" : "right";
    const newMember = createMember(
      nextMemberPosition(member.position, placement),
    );
    setPendingNewMember(newMember);
    setPendingHorizontalSourceId(memberId);
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  /** Open the sheet for an existing member in edit mode. */
  const editExisting = (member: Member) => {
    setEditingMemberId(member.id);
    setIsEditMode(true);
    setIsNewMemberSession(false);
  };

  /** Create a brand-new member from an externally-built Member object (e.g. MemberControls). */
  const createNew = (member: Member) => {
    setPendingNewMember(member);
    setEditingMemberId(member.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  /** Create the very first member, positioned at the given flow coordinates. */
  const addFirstMember = (position: { x: number; y: number }) => {
    const newMember = createMember(position);
    setPendingNewMember(newMember);
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  /** Called when the sheet closes. */
  const closeSheet = () => {
    setEditingMemberId(null);
    setIsNewMemberSession(false);
    setPendingNewMember(null);
    setPendingRelation(null);
    setPendingHorizontalSourceId(null);
  };

  /** Discard the pending new member without saving. */
  const discardNewMember = () => {
    setPendingNewMember(null);
    setPendingRelation(null);
    setPendingHorizontalSourceId(null);
  };

  /** Save the pending new member (replicates onSaveNewMember in FlowPanel). */
  const saveNewMember = async (data: Partial<Member>) => {
    if (pendingNewMember) {
      const newMemberToSave = { ...pendingNewMember, ...data };
      await addMember(newMemberToSave);

      if (pendingRelation) {
        const id = newMemberToSave.id;
        if (pendingRelation.type === "child-of") {
          await addRelation(id, pendingRelation.parentId, "parent");
        } else if (pendingRelation.type === "parent-of") {
          await addRelation(pendingRelation.childId, id, "parent");
        } else if (pendingRelation.type === "related") {
          await addRelation(
            pendingRelation.sourceId,
            id,
            pendingRelation.relationType,
          );
        } else if (pendingRelation.type === "child-of-union") {
          await addRelation(id, pendingRelation.parent1Id, "parent");
          await addRelation(id, pendingRelation.parent2Id, "parent");
        }
        setPendingRelation(null);
      }

      if (pendingHorizontalSourceId) {
        // Member saved — now ask for the relation type.
        onHorizontalRelationReady(
          pendingHorizontalSourceId,
          newMemberToSave.id,
        );
        setPendingHorizontalSourceId(null);
        setEditingMemberId(null);
        setIsNewMemberSession(false);
      }

      setPendingNewMember(null);
    }
  };

  return {
    // State
    pendingNewMember,
    editingMemberId,
    isEditMode,
    isNewMemberSession,
    pendingRelation,
    pendingHorizontalSourceId,
    editingMember,
    // Setters (for useFlowNodes compatibility)
    setEditingMemberId,
    setIsEditMode,
    // Handlers
    onAddChild,
    onAddChildToUnion,
    onAddParent,
    onAddHorizontal,
    editExisting,
    createNew,
    addFirstMember,
    closeSheet,
    discardNewMember,
    saveNewMember,
  };
};
