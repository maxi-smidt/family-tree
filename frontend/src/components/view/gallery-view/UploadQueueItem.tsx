import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RotateCcw, X, CheckCircle, AlertCircle, Clock } from "lucide-react";
import type { UploadQueueItem as UploadQueueItemType } from "@/hooks/useUploadQueue";

interface UploadQueueItemProps {
  item: UploadQueueItemType;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

export function UploadQueueItem({
  item,
  onRetry,
  onCancel,
}: UploadQueueItemProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "gallery-view.view" });

  return (
    <div className="flex items-center gap-2 py-2 px-1">
      {/* Thumbnail */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded border bg-muted">
        <img
          src={item.thumbnailUrl}
          alt={item.name}
          className="h-full w-full object-cover"
        />
      </div>

      {/* Name and status */}
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium"
          title={item.name}
        >
          {item.name}
        </p>
        <div className="mt-0.5">
          {item.status === "queued" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" aria-hidden />
              {t("upload-queue.status-queued")}
            </span>
          )}
          {item.status === "uploading" && (
            <div className="overflow-hidden rounded-full bg-muted h-1.5 w-full">
              <div className="h-full bg-primary animate-[indeterminate_1.5s_ease-in-out_infinite] w-1/2 rounded-full" />
            </div>
          )}
          {item.status === "done" && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle className="size-3" aria-hidden />
              {t("upload-queue.status-done")}
            </span>
          )}
          {item.status === "failed" && (
            <span
              className="flex items-center gap-1 text-xs text-destructive"
              title={item.errorKey ? t(item.errorKey) : undefined}
            >
              <AlertCircle className="size-3" aria-hidden />
              {item.errorKey ? t(item.errorKey) : t("upload-queue.status-failed")}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 gap-1">
        {item.status === "failed" && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onRetry(item.id)}
            aria-label={t("upload-queue.retry")}
            title={t("upload-queue.retry")}
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
        {item.status === "queued" && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onCancel(item.id)}
            aria-label={t("upload-queue.cancel")}
            title={t("upload-queue.cancel")}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
