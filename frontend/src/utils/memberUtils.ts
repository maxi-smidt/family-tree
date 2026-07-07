import { Member } from "@/types/member";
import { getYear } from "@/utils/dateUtils";

export interface MemberOption {
  label: string;
  value: string;
  /** Muted secondary line: born (maiden) name and birth year. */
  sublabel?: string;
  /** Text the picker matches against — full name + maiden name only. */
  searchValue?: string;
}

/** Searchable text for a member: full name plus maiden name (no dates/ids). */
export function getMemberSearchText(
  m: Pick<Member, "firstName" | "lastName" | "maidenName">,
): string {
  return [m.firstName, m.lastName, m.maidenName]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Muted secondary line for a member: born (maiden) name and birth year, e.g.
 * "née Jones · 1900". `formatMaiden` localizes the maiden-name part (it returns
 * the whole "née X" string). Returns undefined when neither piece is known.
 */
export function formatMemberSubLabel(
  maidenName: string | null | undefined,
  birthDate: string | null | undefined,
  formatMaiden: (name: string) => string,
): string | undefined {
  const year = getYear(birthDate);
  const parts = [
    maidenName ? formatMaiden(maidenName) : null,
    year !== null ? String(year) : null,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : undefined;
}

export function getMemberOptions(
  members: Member[],
  formatMaiden: (name: string) => string,
): MemberOption[] {
  return members.map((m) => ({
    label: `${m.firstName} ${m.lastName}`.trim(),
    value: m.id,
    sublabel: formatMemberSubLabel(m.maidenName, m.date.birth, formatMaiden),
    searchValue: getMemberSearchText(m),
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
