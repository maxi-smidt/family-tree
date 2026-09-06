import { useTranslation } from "react-i18next";
import { ChevronsDown, MoveRight, RotateCcw } from "lucide-react";
import { Panel } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { NeighborhoodContinuationDB } from "@/services/WorkspaceService";

interface ContinuationControlsProps {
  continuations: NeighborhoodContinuationDB[];
  atBudget: boolean;
  canExpandGeneration: boolean;
  onExpandGeneration: () => void;
  onLoadMore: () => void;
  onReset: () => void;
}

/**
 * Continuation controls at the graph edge (#989): "Expand next generation"
 * grows the current focus by one more level in both directions; each
 * "Continue into ..." row advances the same continuation cursor the
 * neighborhood endpoint returned, merging the next page into the canvas
 * in place. Only rendered in windowed mode, where these concepts apply.
 */
export const ContinuationControls = ({
  continuations,
  atBudget,
  canExpandGeneration,
  onExpandGeneration,
  onLoadMore,
  onReset,
}: ContinuationControlsProps) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.continuation" });

  if (continuations.length === 0 && !canExpandGeneration && !atBudget) return null;

  return (
    <Panel position="bottom-center" className="pb-2">
      <div className="flex flex-col items-center gap-1.5">
        {atBudget && (
          <div className="rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md">
            {t("budget-reached")}{" "}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={onReset}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              {t("reset")}
            </Button>
          </div>
        )}
        {!atBudget && continuations.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {continuations.map((continuation) => (
              <Button
                key={continuation.section_id ?? "workspace"}
                variant="outline"
                size="sm"
                className="bg-background/90 shadow-md"
                onClick={onLoadMore}
              >
                <MoveRight className="mr-1.5 h-3.5 w-3.5" />
                {continuation.section_name
                  ? t("continue-into", {
                      name: continuation.section_name,
                      count: continuation.remaining_count,
                    })
                  : t("continue-generic", {
                      count: continuation.remaining_count,
                    })}
              </Button>
            ))}
          </div>
        )}
        {!atBudget && canExpandGeneration && (
          <Button
            variant="outline"
            size="sm"
            className="bg-background/90 shadow-md"
            onClick={onExpandGeneration}
          >
            <ChevronsDown className="mr-1.5 h-3.5 w-3.5" />
            {t("expand-generation")}
          </Button>
        )}
      </div>
    </Panel>
  );
};
