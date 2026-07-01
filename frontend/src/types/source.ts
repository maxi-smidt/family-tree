export type FactType =
  | "name"
  | "birth"
  | "death"
  | "birthplace"
  | "hometown"
  | "residence"
  | "cemetery"
  | "general";

export const FACT_TYPES: FactType[] = [
  "name",
  "birth",
  "death",
  "birthplace",
  "hometown",
  "residence",
  "cemetery",
  "general",
];

export interface SourceEvidenceDB {
  id: string;
  kind: string;
  filename: string | null;
  url: string;
  mime_type: string | null;
  size: number | null;
  created_at: string;
}

export interface SourceEvidence {
  id: string;
  kind: string;
  filename: string | null;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}

export interface SourceDB {
  id: string;
  title: string;
  author: string | null;
  publication_info: string | null;
  repository: string | null;
  source_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  evidence?: SourceEvidenceDB[];
}

export interface Source {
  id: string;
  title: string;
  author: string | null;
  publicationInfo: string | null;
  repository: string | null;
  sourceDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: SourceEvidence[];
}

export interface SourceInput {
  title: string;
  author: string;
  publicationInfo: string;
  repository: string;
  sourceDate: string;
  notes: string;
}

export interface CitationDB {
  id: string;
  source_id: string;
  member_id: string;
  fact_type: string;
  page: string | null;
  detail: string | null;
  created_at: string;
}

export interface Citation {
  id: string;
  sourceId: string;
  memberId: string;
  factType: FactType;
  page: string | null;
  detail: string | null;
  createdAt: string;
}

export interface CitationInput {
  sourceId: string;
  memberId: string;
  factType: FactType;
  page: string;
  detail: string;
}

export interface NewEvidence {
  filename: string;
  dataUrl: string;
}

export interface EvidenceOps {
  addedFiles: NewEvidence[];
  addedLinks: { url: string; label: string }[];
  removedIds: string[];
  renamed: { id: string; filename: string }[];
}

export function mapEvidenceFromDB(row: SourceEvidenceDB): SourceEvidence {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    url: row.url,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  };
}

export function mapSourceFromDB(row: SourceDB): Source {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    publicationInfo: row.publication_info,
    repository: row.repository,
    sourceDate: row.source_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidence: (row.evidence ?? []).map(mapEvidenceFromDB),
  };
}

export function mapCitationFromDB(row: CitationDB): Citation {
  return {
    id: row.id,
    sourceId: row.source_id,
    memberId: row.member_id,
    factType: row.fact_type as FactType,
    page: row.page,
    detail: row.detail,
    createdAt: row.created_at,
  };
}
