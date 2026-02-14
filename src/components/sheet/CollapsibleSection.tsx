import { ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

interface CollapsibleSectionProps {
  children: (collapsed: boolean) => ReactNode;
  totalCount: number;
  collapsedCount?: number;
}

export const CollapsibleSection = ({
  children,
  totalCount,
  collapsedCount = 3,
}: CollapsibleSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldCollapse = totalCount > collapsedCount;

  return (
    <div className="space-y-2">
      {children(!shouldCollapse || isExpanded)}
      {shouldCollapse && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-4 h-4 mr-1" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4 mr-1" />
              Show {totalCount - collapsedCount} more
            </>
          )}
        </Button>
      )}
    </div>
  );
};
