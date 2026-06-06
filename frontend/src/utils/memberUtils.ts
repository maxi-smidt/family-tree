import { Member } from "@/types/member";

export interface MemberOption {
  label: string;
  value: string;
}

export function getMemberOptions(members: Member[]): MemberOption[] {
  return members.map((m) => ({
    label: `${m.firstName} ${m.lastName}`,
    value: m.id,
  }));
}

export interface ParentSlots {
  paternalParent: string | null;
  maternalParent: string | null;
}

/**
 * Resolve a member's (up to two) parent slots from their "parent" relations.
 *
 * A gendered parent claims its natural slot first (male → paternal, female →
 * maternal); any leftover parent — one with unknown gender, or a second parent
 * of the same gender — then fills whichever slot is still free. Running the
 * gendered pass first makes the result independent of the order relations come
 * back from the API and stops a later gendered parent from evicting one that
 * was tentatively placed.
 */
export function reconstructParents(
  parentRelations: { to_member_id: string }[],
  genderById: Map<string, string>,
): ParentSlots {
  const slots: ParentSlots = { paternalParent: null, maternalParent: null };

  for (const r of parentRelations) {
    const gender = genderById.get(r.to_member_id);
    if (gender === "m" && !slots.paternalParent) {
      slots.paternalParent = r.to_member_id;
    } else if (gender === "f" && !slots.maternalParent) {
      slots.maternalParent = r.to_member_id;
    }
  }

  for (const r of parentRelations) {
    const id = r.to_member_id;
    if (id === slots.paternalParent || id === slots.maternalParent) continue;
    if (!slots.paternalParent) slots.paternalParent = id;
    else if (!slots.maternalParent) slots.maternalParent = id;
    // More than two parents can't be represented; the rest are ignored.
  }

  return slots;
}
