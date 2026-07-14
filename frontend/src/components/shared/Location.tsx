import * as React from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LocationProps {
  /** The location text to display. */
  location: string;
  /**
   * Optional muted prefix rendered before the location (e.g. "Birthplace").
   * A colon and space are appended automatically.
   */
  label?: string;
  /**
   * When provided, the leading map-pin becomes an interactive button (the
   * "show on map" link). When omitted, the pin is a decorative marker.
   */
  onShowOnMap?: () => void;
  /** Overrides the accessible label/title for the interactive pin. */
  showOnMapLabel?: string;
  /** Extra content rendered inline after the location (e.g. a date range). */
  trailing?: React.ReactNode;
  /**
   * Vertical alignment of the icon relative to the text. Use "start" for rows
   * whose text may wrap to multiple lines; defaults to "center".
   */
  align?: "start" | "center";
  /** Extra classes for the wrapper row (e.g. text sizing/colour overrides). */
  className?: string;
}

/**
 * Renders a location as text preceded by a single MapPin icon. When
 * `onShowOnMap` is supplied the icon is the interactive "show on map" link;
 * otherwise it is a decorative, non-interactive marker. Used everywhere a
 * location is displayed so the presentation stays consistent (issue #635).
 */
export function Location({
  location,
  label,
  onShowOnMap,
  showOnMapLabel,
  trailing,
  align = "center",
  className,
}: LocationProps) {
  const { t } = useTranslation();
  const mapLabel = showOnMapLabel ?? t("common.location.show-on-map");

  return (
    <div
      className={cn(
        "flex gap-1.5 text-sm",
        align === "start" ? "items-start" : "items-center",
        className,
      )}
    >
      {onShowOnMap ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 shrink-0 -ml-0.5 text-muted-foreground"
          aria-label={mapLabel}
          title={mapLabel}
          onClick={onShowOnMap}
        >
          <MapPin className="size-3.5" aria-hidden="true" />
        </Button>
      ) : (
        // A fixed line-height (h-5) box centres the pin against the first line
        // of text, so it stays aligned whether or not the text wraps.
        <span className="flex h-5 shrink-0 items-center">
          <MapPin
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </span>
      )}
      <span>
        {label && <span className="text-muted-foreground">{label}: </span>}
        {location}
        {trailing}
      </span>
    </div>
  );
}
