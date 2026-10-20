import { useState } from "react";
import { MemberSheet } from "./MemberSheet";
import { createMember } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { NODE_WIDTH } from "@/constants";

/** A global creation panel that leaves the current view and its drafts in place. */
export default function NewPersonSheet({ onClose }: { onClose: () => void }) {
  const addMember = useMemberStore((s) => s.addMember);
  const [member] = useState(() => {
    const rightmost = useMemberStore
      .getState()
      .members.reduce(
        (max, person) => Math.max(max, person.position.x),
        -NODE_WIDTH,
      );
    return createMember({ x: rightmost + NODE_WIDTH + 60, y: 0 });
  });

  return (
    <MemberSheet
      isOpen
      member={member}
      initialEditMode
      isNewMember
      syncNavigation={false}
      onClose={onClose}
      onSaveNewMember={async (data) => {
        await addMember(data);
      }}
    />
  );
}
