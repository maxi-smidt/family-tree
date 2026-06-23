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

type DateField = "day" | "month" | "year";

/** Order in which day / month / year appear for the given locale. */
function getLocaleDateOrder(locale: string): DateField[] {
  const parts = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(2000, 0, 2));
  const order: DateField[] = [];
  for (const part of parts) {
    if (part.type === "day") order.push("day");
    else if (part.type === "month") order.push("month");
    else if (part.type === "year") order.push("year");
  }
  return order.length === 3 ? order : ["day", "month", "year"];
}

/** Separator a locale uses between date fields (e.g. "." for de, "/" for en). */
function getLocaleDateSeparator(locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(2000, 0, 2));
  const literal = parts.find((p) => p.type === "literal");
  const trimmed = literal?.value.trim();
  return trimmed && trimmed.length > 0 ? trimmed[0] : ".";
}

/**
 * Render a partial date as a numeric, re-typeable string in the locale's field
 * order (e.g. "23.06.2026" for de, "06/23/2026" for en, "2026" for year-only).
 * Unlike {@link formatDate} this never uses long month names, so the result can
 * be fed straight back into {@link parsePartialDateInput}.
 */
export function formatPartialDateForInput(
  value: string | null | undefined,
  language?: string,
): string {
  const precision = getDatePrecision(value);
  if (!value || !precision) return "";

  const [year, month, day] = value.split("-");
  if (precision === "year") return year;

  const locale = resolveDateLocale(language);
  const separator = getLocaleDateSeparator(locale);
  const fieldValues: Record<DateField, string | undefined> = {
    year,
    month,
    day: precision === "day" ? day : undefined,
  };
  return getLocaleDateOrder(locale)
    .map((field) => fieldValues[field])
    .filter((part): part is string => part !== undefined)
    .join(separator);
}

/**
 * Parse a user-typed date into the internal partial-date format
 * (`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`). Accepts `.`, `/`, `-` or whitespace as
 * separators, ISO order (year first) as well as the locale's field order, and
 * partial precision (year only, or month + year). The year must be four digits.
 *
 * Returns `{ value: null, valid: true }` for empty input (a deliberate clear)
 * and `{ value: null, valid: false }` for anything unparseable.
 */
export function parsePartialDateInput(
  text: string,
  language?: string,
): { value: string | null; valid: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, valid: true };

  const invalid = { value: null, valid: false } as const;

  const tokens = trimmed.split(/[\s./-]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return invalid;
  if (!tokens.every((token) => /^\d+$/.test(token))) return invalid;

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  if (tokens.length === 1) {
    if (tokens[0].length !== 4) return invalid;
    year = Number(tokens[0]);
  } else if (tokens[0].length === 4) {
    // ISO-style: year first.
    year = Number(tokens[0]);
    month = Number(tokens[1]);
    if (tokens[2] !== undefined) day = Number(tokens[2]);
  } else {
    // Locale field order; the four-digit token is the year.
    const yearIndex = tokens.findIndex((token) => token.length === 4);
    if (yearIndex === -1) return invalid;
    year = Number(tokens[yearIndex]);
    const rest = tokens.filter((_, i) => i !== yearIndex);
    if (rest.length === 1) {
      // A single non-year token is always the month (e.g. "06.2026").
      month = Number(rest[0]);
    } else {
      const order = getLocaleDateOrder(resolveDateLocale(language)).filter(
        (field) => field !== "year",
      );
      rest.forEach((token, i) => {
        if (order[i] === "day") day = Number(token);
        else month = Number(token);
      });
    }
  }

  const currentYear = new Date().getFullYear();
  if (year === null || year < 1 || year > currentYear) return invalid;
  if (month !== null && (month < 1 || month > 12)) return invalid;
  if (day !== null) {
    if (month === null) return invalid;
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day < 1 || day > daysInMonth) return invalid;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  if (day !== null && month !== null) {
    return { value: `${year}-${pad(month)}-${pad(day)}`, valid: true };
  }
  if (month !== null) return { value: `${year}-${pad(month)}`, valid: true };
  return { value: `${year}`, valid: true };
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
