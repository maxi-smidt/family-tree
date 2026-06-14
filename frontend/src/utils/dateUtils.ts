import i18n from "@/i18n/i18n";

type DateInput = Date | string | null | undefined;

type FormatDateOptions = Intl.DateTimeFormatOptions & {
  language?: string;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^(\d{4})$/;

const LANGUAGE_LOCALES: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
};

export type DatePrecision = "day" | "month" | "year" | null;

export function getDatePrecision(value: string | null | undefined): DatePrecision {
  if (!value) return null;
  if (DATE_ONLY_RE.test(value)) return "day";
  if (YEAR_MONTH_RE.test(value)) return "month";
  if (YEAR_RE.test(value)) return "year";
  return null;
}

export function isValidPartialDate(value: string): boolean {
  return getDatePrecision(value) !== null;
}

/** Compare two partial date strings. Returns negative, zero, or positive. */
export function comparePartialDates(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  // Lexicographic on the common prefix works for YYYY, YYYY-MM, YYYY-MM-DD.
  return a.localeCompare(b);
}

/** Extract the 4-digit year from a partial date string without using `new Date`. */
export function getYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function formatDateWithFallback(
  dateString: DateInput,
  t: (key: string) => string,
  options?: FormatDateOptions,
): string {
  if (!dateString) return t("common.date-unknown");
  return formatDate(dateString, options) || t("common.date-unknown");
}

export function formatDate(
  dateString: DateInput,
  options: FormatDateOptions = {},
): string {
  if (!dateString) return "";
  if (typeof dateString === "string") {
    const precision = getDatePrecision(dateString);
    const { language, ...intlOptions } = options;
    const locale = resolveDateLocale(language);
    if (precision === "year") {
      return dateString.slice(0, 4);
    }
    if (precision === "month") {
      const [year, month] = dateString.split("-").map(Number);
      const d = new Date(year, month - 1, 1);
      return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", ...intlOptions }).format(d);
    }
    if (precision === "day") {
      const [y, mo, day] = dateString.split("-").map(Number);
      const d = new Date(y, mo - 1, day);
      return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", ...intlOptions }).format(d);
    }
    // Unrecognized string — fall through to Date parse for full ISO timestamps (event dates, etc.)
  }
  const date = parseDateInput(dateString);
  if (!date) return "";
  const { language, ...intlOptions } = options;
  return new Intl.DateTimeFormat(resolveDateLocale(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...intlOptions,
  }).format(date);
}

export function formatDateTime(
  dateString: DateInput,
  options: FormatDateOptions = {},
): string {
  return formatDate(dateString, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...options,
  });
}

export function resolveDateLocale(language = i18n.resolvedLanguage): string {
  const fallbackLanguage = i18n.language?.split("-")[0];
  const baseLanguage = language?.split("-")[0] ?? fallbackLanguage;
  return LANGUAGE_LOCALES[baseLanguage] ?? LANGUAGE_LOCALES.en;
}

function parseDateInput(dateInput: Date | string): Date | null {
  if (dateInput instanceof Date) {
    return Number.isNaN(dateInput.getTime()) ? null : dateInput;
  }

  const dateOnlyParts = DATE_ONLY_RE.exec(dateInput);
  const date = dateOnlyParts
    ? new Date(
        Number(dateOnlyParts[1]),
        Number(dateOnlyParts[2]) - 1,
        Number(dateOnlyParts[3]),
      )
    : new Date(dateInput);

  return Number.isNaN(date.getTime()) ? null : date;
}
