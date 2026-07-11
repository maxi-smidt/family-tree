import { ReactNode, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Location } from "@/components/shared/Location";
import { cn } from "@/lib/utils";

interface ContentCardProps {
  icon: LucideIcon;
  title: string;
  date?: string | null;
  location?: string | null;
  description?: string | null;
  metadata?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  collapsible?: boolean;
  expanded?: boolean;
  onShowLocationOnMap?: () => void;
}

/**
 * Shared presentation for member-linked narrative content. It keeps the title,
 * date, place, details and actions in the same visual order whether the item
 * is shown in a member sheet or on the timeline.
 */
export function ContentCard({
  icon: Icon,
  title,
  date,
  location,
  description,
  metadata,
  actions,
  children,
  className,
  collapsible = false,
  expanded,
  onShowLocationOnMap,
}: ContentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = Boolean(description);
  const canCollapse = collapsible && hasDetails;
  const showDetails = expanded ?? (canCollapse ? isExpanded : true);

  const heading = (
    <>
      {canCollapse &&
        (showDetails ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ))}
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{title}</span>
      {metadata}
    </>
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {canCollapse ? (
            <button
              type="button"
              aria-expanded={showDetails}
              onClick={() => setIsExpanded((value) => !value)}
              className="mb-1 flex w-full items-center gap-2 text-left"
            >
              {heading}
            </button>
          ) : (
            <div className="mb-1 flex items-center gap-2">{heading}</div>
          )}

          {(date || location) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {date}
                </span>
              )}
              {location && (
                <Location
                  location={location}
                  onShowOnMap={onShowLocationOnMap}
                />
              )}
            </div>
          )}

          {hasDetails && showDetails && (
            <p className="mt-2 whitespace-pre-wrap text-sm">{description}</p>
          )}
          {children}
        </div>
        {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
      </div>
    </div>
  );
}
