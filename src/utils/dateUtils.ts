import { format } from "date-fns";

export function formatDate(
  dateString: string | null,
  t: (key: string) => string,
  formatStr: string = "dd.MM.yyyy",
): string {
  if (!dateString) return t("common.date-unknown");
  return format(new Date(dateString), formatStr);
}
