import { ReactNode, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Location } from "@/components/shared/Location";
import { cn } from "@/lib/utils";

interface CollapsibleEventProps {
  icon: LucideIcon;
  typeLabel: string;
  date: string;
  location?: string | null;
  description?: string | null;
  /** Optional action buttons (e.g. edit/delete) shown in the header row. */
  actions?: ReactNode;
  /** Extra always-visible content below the summary (e.g. linked documents,
   *  which already collapse behind their own indicator). */
  children?: ReactNode;
  className?: string;
}

/** A single life event whose (optional) description is collapsed by default.
 *  The compact summary — event type, date and location — stays visible, and a
 *  chevron next to the event type reveals the description on demand. Events
 *  without a description are not collapsible and render without a chevron. */
export const CollapsibleEvent = ({
  icon: Icon,
  typeLabel,
  date,
  location,
  description,
  actions,
  children,
  className,
}: CollapsibleEventProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDescription = !!description;

  return (
    <div
      className={cn(
        "border rounded-lg p-3 hover:bg-accent/50 transition-colors",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {hasDescription ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((prev) => !prev)}
              className="flex w-full items-center gap-2 font-medium mb-1 text-left"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
              )}
              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="truncate">{typeLabel}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 font-medium mb-1">
              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="truncate">{typeLabel}</span>
            </div>
          )}
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{date}</span>
            </div>
            {location && <Location location={location} />}
          </div>
          {hasDescription && isExpanded && (
            <p className="text-sm mt-2 whitespace-pre-wrap">{description}</p>
          )}
          {children}
        </div>
        {actions && <div className="flex gap-1 shrink-0">{actions}</div>}
      </div>
    </div>
  );
};
