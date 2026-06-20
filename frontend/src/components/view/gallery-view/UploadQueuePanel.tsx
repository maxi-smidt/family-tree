import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";
import { UploadQueueItem } from "@/components/view/gallery-view/UploadQueueItem";
import type { UploadQueueItem as UploadQueueItemType } from "@/hooks/useUploadQueue";

interface UploadQueuePanelProps {
  items: UploadQueueItemType[];
  total: number;
  doneCount: number;
  isActive: boolean;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onClearCompleted: () => void;
}

export function UploadQueuePanel({
  items,
  total,
  doneCount,
  isActive,
  onRetry,
  onCancel,
  onClearCompleted,
}: UploadQueuePanelProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view.view.upload-queue",
  });
  const [minimized, setMinimized] = useState(false);

  if (items.length === 0) return null;

  const progressPercent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 shadow-lg"
      role="region"
      aria-label={t("title")}
    >
      <Card className="gap-0 py-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm font-semibold">{t("title")}</span>
          <div className="flex items-center gap-2">
            {!isActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onClearCompleted}
              >
                {t("clear-completed")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setMinimized((m) => !m)}
              aria-label={minimized ? t("expand") : t("minimize")}
            >
              {minimized ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </Button>
          </div>
        </div>

        {!minimized && (
          <>
            {/* Progress bar */}
            <div className="px-4 py-2 border-b">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t("progress", { done: doneCount, total })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {progressPercent}%
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={doneCount}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-label={t("progress", { done: doneCount, total })}
              >
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Scrollable item list */}
            <div className="max-h-64 overflow-y-auto divide-y px-4">
              {items.map((item) => (
                <UploadQueueItem
                  key={item.id}
                  item={item}
                  onRetry={onRetry}
                  onCancel={onCancel}
                />
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
