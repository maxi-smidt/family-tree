import { format } from "date-fns";

export function formatDateWithFallback(
  dateString: string | null,
  t: (key: string) => string,
  formatStr: string = "dd.MM.yyyy",
): string {
  if (!dateString) return t("common.date-unknown");
  return formatDate(dateString, formatStr);
}

export function formatDate(
  dateString: string | null,
  formatStr: string = "dd.MM.yyyy",
): string {
  if (!dateString) return "";
  return format(new Date(dateString), formatStr);
}
