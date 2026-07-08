import { CheckCircle2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useGeocodePreview } from "@/hooks/useGeocodePreview";

interface GeocodeHintProps {
  location: string | null | undefined;
  enabled?: boolean;
  className?: string;
}

// Resolution hint shown beneath a location input: tells the user whether the
// address they typed was geocoded (and to where). Shared by the event dialog
// and the member edit sheet.
export function GeocodeHint({
  location,
  enabled = true,
  className,
}: GeocodeHintProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "common.geocode" });
  const { status, displayName } = useGeocodePreview(location, enabled);

  if (status === "idle") return null;

  if (status === "checking") {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t("checking")}
      </p>
    );
  }

  if (status === "found") {
    return (
      <p
        className={cn(
          "text-xs text-green-600 flex items-center gap-1",
          className,
        )}
      >
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        {displayName || t("found")}
      </p>
    );
  }

  return (
    <p
      className={cn(
        "text-xs text-amber-600 flex items-center gap-1",
        className,
      )}
    >
      <AlertCircle className="w-3 h-3 shrink-0" />
      {t("not-found")}
    </p>
  );
}
