/** A workspace section (#982): a named, overlapping organizational branch.
 *  Field names mirror the backend `SectionOut` schema, which is plain
 *  snake_case (not `FamilyTreeOrmBaseModel`) — see `schemas/section.py`. */
export interface SectionDB {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  created_at: string;
  member_count: number;
  /** Whether this principal's grant covers writing to this specific section
   *  (#1029) — a section-scoped editor grant may not cover every section the
   *  workspace-level role would otherwise suggest. */
  can_write: boolean;
}

export interface SectionCreateInput {
  name: string;
  root_member_id?: string | null;
  direction?: "direct_family" | "partnership";
}

export interface SectionUpdateInput {
  name?: string;
  position?: number;
}

export interface SectionOverlapDB {
  section_id: string;
  section_name: string;
  member_count: number;
}

export interface SectionPreviewDB {
  primary_member_ids: string[];
  boundary_member_ids: string[];
  overlaps: SectionOverlapDB[];
}

/** What a section still holds, shown before it is deleted — a nonzero count
 *  here blocks the delete (backend RESTRICT) until it is resolved. */
export interface SectionDependentsDB {
  section_id: string;
  member_count: number;
  content_scope_counts: Record<string, number>;
  grant_count: number;
  invitation_count: number;
  public_link_count: number;
}

/** A section suggested for a newly-created member, based on their
 *  parents'/partners' existing membership — surfaced for confirmation before
 *  the member is ever silently added (#990). */
export interface SectionSuggestionDB {
  section: SectionDB;
  matched_via_member_ids: string[];
}
