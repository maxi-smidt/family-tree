/**
 * Supported locales for the legal documents (Terms / Privacy / Impressum).
 * Kept in sync with the backend `LEGAL_LOCALES` / `LEGAL_DEFAULT_LOCALE`
 * (`app/services/legal_defaults.py`). German is the authoritative default;
 * English is a secondary translation. The backend falls back to German when a
 * requested locale's body is empty.
 */
export const LEGAL_LOCALES = ["de", "en"] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];
export const LEGAL_DEFAULT_LOCALE: LegalLocale = "de";
