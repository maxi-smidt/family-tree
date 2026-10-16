import { Member, isDeceased } from "@/types/member";

/** The same member filters offered by List view; unknown keys are retained
 * in the saved config for forward compatibility but do not invent predicates. */
export function filterSavedViewMembers(
  members: Member[],
  filters: Record<string, unknown>,
): Member[] {
  return members.filter((member) => {
    if (
      ["m", "f", "o"].includes(String(filters.gender)) &&
      member.gender !== filters.gender
    )
      return false;
    if (filters.status === "alive" && isDeceased(member)) return false;
    if (filters.status === "deceased" && !isDeceased(member)) return false;
    return filters.hasPhoto !== true || !!member.imageData;
  });
}
