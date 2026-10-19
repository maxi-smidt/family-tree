/** Evidence for person fields: a document cited for one field of a member,
 *  optionally pointing at one of its files, a page and a quoted passage. */

/** The person fields that can carry evidence. */
export const CITABLE_FIELDS = [
  "first_name",
  "middle_names",
  "last_name",
  "maiden_name",
  "baptismal_name",
  "date_of_birth",
  "date_of_death",
  "birthplace",
] as const;

export type CitableField = (typeof CITABLE_FIELDS)[number];

export interface MemberFieldCitationDB {
  id: string;
  member_id: string;
  field: CitableField;
  document_id: string;
  document_file_id: string | null;
  page: number | null;
  quote: string | null;
  quote_prefix: string | null;
  quote_suffix: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  quote_found: boolean | null;
}

export interface MemberFieldCitation {
  id: string;
  memberId: string;
  field: CitableField;
  documentId: string;
  fileId: string | null;
  page: number | null;
  quote: string | null;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  note: string | null;
  createdAt: string;
  /** Whether the quote still appears in the file's text; `null` when there
   *  is nothing to check (no quote, or the file has no text). */
  quoteFound: boolean | null;
}

/** Where in its document a citation points, and its note. */
export interface CitationAnchor {
  fileId: string | null;
  page: number | null;
  quote: string | null;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  note: string | null;
}

export interface CitationInput extends CitationAnchor {
  memberId: string;
  field: CitableField;
  documentId: string;
}

export const mapCitationFromDB = (
  row: MemberFieldCitationDB,
): MemberFieldCitation => ({
  id: row.id,
  memberId: row.member_id,
  field: row.field,
  documentId: row.document_id,
  fileId: row.document_file_id,
  page: row.page,
  quote: row.quote,
  quotePrefix: row.quote_prefix,
  quoteSuffix: row.quote_suffix,
  note: row.note,
  createdAt: row.created_at,
  quoteFound: row.quote_found,
});

export const mapCitationAnchorToDB = (anchor: CitationAnchor) => ({
  document_file_id: anchor.fileId,
  page: anchor.page,
  quote: anchor.quote,
  quote_prefix: anchor.quotePrefix,
  quote_suffix: anchor.quoteSuffix,
  note: anchor.note,
});

/** How many of the visible people's filled-in key facts have evidence. */
export interface EvidenceCoverageDB {
  facts_total: number;
  facts_cited: number;
  missing: { member_id: string; name: string; fields: CitableField[] }[];
  missing_member_count: number;
  quotes_not_found: MemberFieldCitationDB[];
}

export interface EvidenceCoverage {
  factsTotal: number;
  factsCited: number;
  missing: { memberId: string; name: string; fields: CitableField[] }[];
  missingMemberCount: number;
  quotesNotFound: MemberFieldCitation[];
}

export const mapEvidenceCoverageFromDB = (
  row: EvidenceCoverageDB,
): EvidenceCoverage => ({
  factsTotal: row.facts_total,
  factsCited: row.facts_cited,
  missing: row.missing.map((entry) => ({
    memberId: entry.member_id,
    name: entry.name,
    fields: entry.fields,
  })),
  missingMemberCount: row.missing_member_count,
  quotesNotFound: row.quotes_not_found.map(mapCitationFromDB),
});
