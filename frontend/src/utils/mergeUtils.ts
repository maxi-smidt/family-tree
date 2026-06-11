/**
 * Pure helper functions for the merge conflict-resolution UI (#166).
 *
 * Kept in a standalone module so they can be unit-tested without DOM or
 * network dependencies.
 */

import { MemberDB } from "@/types/member";
import {
  DuplicatePair,
  MergeFieldChoice,
  MergeResolution,
} from "@/types/merge";

/**
 * Fields that can be chosen / combined when resolving merge conflicts.
 * Mirrors the backend's _CONFLICT_FIELDS list.
 */
export const RESOLVABLE_FIELDS: readonly string[] = [
  "maidenName",
  "birthplace",
  "hometown",
  "placesLived",
  "additionalData",
  "imageData",
  "dateOfBirth",
  "dateOfDeath",
];

/**
 * Fields for which the "Combine" option makes sense (free-form text).
 */
export const COMBINABLE_FIELDS: readonly string[] = [
  "additionalData",
  "placesLived",
];

/**
 * Per-pair UI state that the user fills in during the resolve step.
 */
export interface PairResolutionState {
  action: "merge" | "keep_both";
  /** Only relevant when action === "merge". */
  fields: Partial<Record<string, MergeFieldChoice>>;
}

/**
 * Build the initial resolution state for a duplicate pair from the backend's
 * `default_action` suggestion and its conflict list.
 */
export function buildInitialResolutionState(
  pair: DuplicatePair,
): PairResolutionState {
  const fields: Partial<Record<string, MergeFieldChoice>> = {};
  for (const field of pair.conflicts) {
    // Default field choice: "a" (keep source-A value)
    fields[field] = "a";
  }
  return {
    action: pair.default_action,
    fields,
  };
}

/**
 * Convert the map of per-pair UI state into the `resolutions` array expected
 * by POST /trees/merge.
 *
 * Only pairs that are not using the server default need a resolution entry,
 * but we send all to keep the logic simple.
 */
export function buildResolutionsPayload(
  pairs: DuplicatePair[],
  states: Map<string, PairResolutionState>,
): MergeResolution[] {
  return pairs.map((pair) => {
    const pairKey = buildPairKey(pair.member_a.id, pair.member_b.id);
    const state = states.get(pairKey) ?? buildInitialResolutionState(pair);
    return {
      member_a_id: pair.member_a.id,
      member_b_id: pair.member_b.id,
      action: state.action,
      fields: state.action === "merge" ? { ...state.fields } : {},
    };
  });
}

/**
 * A stable string key for a pair that is order-insensitive.
 */
export function buildPairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join("|");
}

/**
 * Human-readable display label for a member (first + last name).
 */
export function memberDisplayName(m: MemberDB): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ") || "(unknown)";
}

/**
 * Return the value of a named field from a MemberDB record.
 */
export function getMemberField(
  member: MemberDB,
  field: string,
): string | null | undefined {
  return (member as unknown as Record<string, unknown>)[field] as
    | string
    | null
    | undefined;
}

/**
 * Return true when both member values are non-empty and differ.
 * Used to decide whether to show a highlighted conflict badge.
 */
export function isFieldConflicting(
  pair: DuplicatePair,
  field: string,
): boolean {
  return pair.conflicts.includes(field);
}
