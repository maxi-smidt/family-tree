import { ReactNode, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleStoryProps {
  title: string;
  content?: string | null;
  /** Optional action buttons (e.g. edit/delete) shown in the header row. */
  actions?: ReactNode;
  /** Extra content revealed alongside the story body when expanded. */
  children?: ReactNode;
  className?: string;
}

/** A single story rendered collapsed by default: only the title and a chevron
 *  disclosure control are visible. Clicking the title toggles the story body
 *  (newlines preserved) and any children (e.g. linked documents) into view. */
export const CollapsibleStory = ({
  title,
  content,
  actions,
  children,
  className,
}: CollapsibleStoryProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={cn(
        "border rounded-lg p-3 hover:bg-accent/50 transition-colors",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
          <BookOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
          <h4 className="font-medium truncate">{title}</h4>
        </button>
        {actions && <div className="flex gap-1 shrink-0">{actions}</div>}
      </div>

      {isExpanded && (
        <div className="mt-2">
          {content && (
            <div className="text-sm whitespace-pre-wrap">{content}</div>
          )}
          {children}
        </div>
      )}
    </div>
  );
};
