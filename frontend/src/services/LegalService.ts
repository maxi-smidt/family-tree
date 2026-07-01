import { api } from "@/services/api";

export interface LegalPublicDocuments {
  terms_body: string;
  privacy_body: string;
  imprint_body: string;
  version: string;
  /** The locale actually served (may fall back to German when empty). */
  locale: string;
}

export interface LegalAcceptanceStatus {
  accepted: boolean;
  version: string;
}

export type LegalDocumentType = "terms" | "privacy" | "imprint";

export interface LegalDocumentVersionSummary {
  id: string;
  document_type: LegalDocumentType;
  locale: string;
  version: string;
  content_hash: string;
  published_at: string;
}

export interface LegalDocumentVersionDetail extends LegalDocumentVersionSummary {
  body: string;
}

const BASE = "/legal";

export const LegalService = {
  getPublicDocuments(locale: string): Promise<LegalPublicDocuments> {
    return api.get<LegalPublicDocuments>(
      `${BASE}/public?locale=${encodeURIComponent(locale)}`,
    );
  },

  accept(locale: string): Promise<LegalAcceptanceStatus> {
    return api.post<LegalAcceptanceStatus>(
      `${BASE}/accept?locale=${encodeURIComponent(locale)}`,
    );
  },

  listVersions(): Promise<LegalDocumentVersionSummary[]> {
    return api.get<LegalDocumentVersionSummary[]>(`${BASE}/versions`);
  },

  getVersion(id: string): Promise<LegalDocumentVersionDetail> {
    return api.get<LegalDocumentVersionDetail>(`${BASE}/versions/${id}`);
  },
};
