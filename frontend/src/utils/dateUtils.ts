import i18n from "@/i18n/i18n";

type DateInput = Date | string | null | undefined;

type FormatDateOptions = Intl.DateTimeFormatOptions & {
  language?: string;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const LANGUAGE_LOCALES: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
};

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
