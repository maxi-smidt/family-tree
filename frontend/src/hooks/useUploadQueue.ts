import { useCallback, useEffect, useRef, useState } from "react";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";
import { ApiError } from "@/services/api";
import { getQuotaBucket, quotaToastKey } from "@/lib/quotaError";
import { formatDateTime } from "@/utils/dateUtils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export type UploadStatus = "queued" | "uploading" | "done" | "failed";

export interface UploadQueueItem {
  id: string;
  file: File;
  name: string;
  thumbnailUrl: string;
  status: UploadStatus;
  errorKey?: string;
}

interface UploadQueueState {
  items: UploadQueueItem[];
  enqueue: (files: File[]) => void;
  retry: (id: string) => void;
  cancel: (id: string) => void;
  clearCompleted: () => void;
  total: number;
  doneCount: number;
  isActive: boolean;
}

const MAX_CONCURRENT = 3;

function mapErrorToKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) {
      const bucket = getQuotaBucket(err.message);
      if (bucket) {
        return quotaToastKey(bucket);
      }
      return "toast-error-image-too-large";
    }
    if (err.status === 400) {
      return "toast-error-image-unsupported";
    }
  }
  return "toast-error-image-upload";
}

export function useUploadQueue(): UploadQueueState {
  const { t } = useTranslation(undefined, { keyPrefix: "gallery-view.view" });
  const [items, setItemsState] = useState<UploadQueueItem[]>([]);
  // Ref is the source of truth for the worker; state is for rendering only.
  const itemsRef = useRef<UploadQueueItem[]>([]);

  // Track object URLs for cleanup
  const objectUrlsRef = useRef<Set<string>>(new Set());
  // Prevent concurrent worker invocations
  const workerRunningRef = useRef(false);

  const setItems = useCallback(
    (updater: (prev: UploadQueueItem[]) => UploadQueueItem[]) => {
      const next = updater(itemsRef.current);
      itemsRef.current = next;
      setItemsState(next);
    },
    [],
  );

  // Revoke a set of object URLs
  const revokeUrls = useCallback((urls: string[]) => {
    for (const url of urls) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(url);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current.clear();
    };
  }, []);

  const runWorker = useCallback(async () => {
    if (workerRunningRef.current) return;
    workerRunningRef.current = true;

    try {
      while (true) {
        const snapshot = itemsRef.current;

        const inFlight = snapshot.filter(
          (i) => i.status === "uploading",
        ).length;
        const queued = snapshot.filter((i) => i.status === "queued");

        if (queued.length === 0 && inFlight === 0) {
          // All done — check if we need to refresh
          const hasDone = snapshot.some((i) => i.status === "done");
          const hasFailed = snapshot.some((i) => i.status === "failed");

          if (hasDone) {
            // Batch refresh once
            await useGalleryStore.getState().refreshGalleryImages();
            useStorageStore.getState().refreshStorageUsage();
            invalidateActivityView();

            if (hasFailed) {
              const doneCount = snapshot.filter(
                (i) => i.status === "done",
              ).length;
              const failedCount = snapshot.filter(
                (i) => i.status === "failed",
              ).length;
              toast.warning(
                t("upload-queue.summary-partial", {
                  done: doneCount,
                  failed: failedCount,
                }),
              );
            } else {
              toast.success(
                t("upload-queue.summary-success", {
                  count: snapshot.filter((i) => i.status === "done").length,
                }),
              );
            }
          }
          break;
        }

        if (inFlight >= MAX_CONCURRENT || queued.length === 0) {
          // Wait a tick and re-check (items complete asynchronously)
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          continue;
        }

        // Pick up to (MAX_CONCURRENT - inFlight) queued items
        const toStart = queued.slice(0, MAX_CONCURRENT - inFlight);

        // Mark them uploading
        setItems((prev) =>
          prev.map((item) =>
            toStart.some((s) => s.id === item.id)
              ? { ...item, status: "uploading" as const }
              : item,
          ),
        );

        // Process each concurrently without awaiting all (fire and track)
        for (const item of toStart) {
          (async () => {
            try {
              await useGalleryStore.getState().addGalleryImage(
                {
                  file: item.file,
                  title: formatDateTime(new Date()),
                  description: null,
                  linkedMemberIds: [],
                },
                { refresh: false },
              );
              setItems((prev) =>
                prev.map((i) =>
                  i.id === item.id ? { ...i, status: "done" as const } : i,
                ),
              );
            } catch (err: unknown) {
              const errorKey = mapErrorToKey(err);
              setItems((prev) =>
                prev.map((i) =>
                  i.id === item.id
                    ? { ...i, status: "failed" as const, errorKey }
                    : i,
                ),
              );
            }
          })();
        }
      }
    } finally {
      workerRunningRef.current = false;
    }
  }, [t, setItems]);

  const enqueue = useCallback(
    (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      const newItems: UploadQueueItem[] = imageFiles.map((file) => {
        const thumbnailUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(thumbnailUrl);
        return {
          id: crypto.randomUUID(),
          file,
          name: file.name,
          thumbnailUrl,
          status: "queued" as const,
        };
      });

      setItems((prev) => [...prev, ...newItems]);

      // Kick the worker after state update
      setTimeout(() => runWorker(), 0);
    },
    [runWorker, setItems],
  );

  const retry = useCallback(
    (id: string) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: "queued" as const, errorKey: undefined }
            : item,
        ),
      );
      setTimeout(() => runWorker(), 0);
    },
    [runWorker, setItems],
  );

  const cancel = useCallback(
    (id: string) => {
      setItems((prev) => {
        const item = prev.find((i) => i.id === id);
        if (item && item.status === "queued") {
          revokeUrls([item.thumbnailUrl]);
          return prev.filter((i) => i.id !== id);
        }
        return prev;
      });
    },
    [revokeUrls, setItems],
  );

  const clearCompleted = useCallback(() => {
    setItems((prev) => {
      const toRemove = prev.filter(
        (i) => i.status === "done" || i.status === "failed",
      );
      revokeUrls(toRemove.map((i) => i.thumbnailUrl));
      return prev.filter((i) => i.status !== "done" && i.status !== "failed");
    });
  }, [revokeUrls, setItems]);

  const total = items.length;
  const doneCount = items.filter(
    (i) => i.status === "done" || i.status === "failed",
  ).length;
  const isActive = items.some(
    (i) => i.status === "queued" || i.status === "uploading",
  );

  return {
    items,
    enqueue,
    retry,
    cancel,
    clearCompleted,
    total,
    doneCount,
    isActive,
  };
}
