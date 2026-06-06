import { ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.member-sheet" });
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
              <ChevronUp />
              {t("show-less")}
            </>
          ) : (
            <>
              <ChevronDown />
              {t("show-more", { count: totalCount - collapsedCount })}
            </>
          )}
        </Button>
      )}
    </div>
  );
};
