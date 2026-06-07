import i18n from "@/i18n/i18n";

export function formatDateWithFallback(
  dateString: string | null,
  t: (key: string) => string
): string {
  if (!dateString) return t("common.date-unknown");
  return formatDate(dateString);
}

export function formatDate(
  dateString: string | Date | null
): string {
  if (!dateString) return "";
  const date = typeof dateString === "string" ? new Date(dateString) : dateString;
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString(i18n.language, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
