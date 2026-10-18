import { isDeceased, type Member } from "@/types/member";
import { getYear } from "@/utils/dateUtils";

// Kept out of memberUtils: that module is shared with the tree-layout web
// worker, and dateUtils pulls in the i18n setup, which needs localStorage.
/**
 * Age in whole years from the birth and death years: the age reached for the
 * deceased, the current age for the living, null when it can't be told.
 */
export function computeAge(member: Member): {
  age: number | null;
  atDeath: boolean;
} {
  const birthYear = getYear(member.date.birth);
  if (!birthYear) return { age: null, atDeath: false };
  const deathYear = getYear(member.date.death);
  if (deathYear !== null) return { age: deathYear - birthYear, atDeath: true };
  if (!isDeceased(member))
    return { age: new Date().getFullYear() - birthYear, atDeath: false };
  return { age: null, atDeath: false };
}
