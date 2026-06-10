/**
 * Types for the merge preview / resolution feature (#166).
 * These match the backend Pydantic schemas in app/schemas/merge.py.
 */

import { MemberDB } from "./member";

export type MergeMatchType = "exact" | "possible";
export type MergeDefaultAction = "merge" | "keep_both";
export type MergeFieldChoice = "a" | "b" | "combine";

export interface DuplicatePair {
  member_a: MemberDB;
  member_b: MemberDB;
  match: MergeMatchType;
  conflicts: string[];
  default_action: MergeDefaultAction;
}

export interface MergePreviewResult {
  total_members: number;
  merged_count: number;
  duplicates: DuplicatePair[];
}

/**
 * Resolution for a single duplicate pair, sent in the POST /trees/merge body.
 */
export interface MergeResolution {
  member_a_id: string;
  member_b_id: string;
  action: MergeDefaultAction;
  fields: Partial<Record<string, MergeFieldChoice>>;
}
