/**
 * Displays per-tree storage usage (tree data / media / total) with quota limits.
 * Shows "unlimited" when the quota is null.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStorageStore } from "@/hooks/useStorageStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface UsageRowProps {
  label: string;
  used: number;
  quota: number | null;
  unlimitedLabel: string;
  usedOfLabel: (used: string, quota: string) => string;
}

function UsageRow({
  label,
  used,
  quota,
  unlimitedLabel,
  usedOfLabel,
}: UsageRowProps) {
  const usedFmt = formatBytes(used);
  const quotaFmt = quota != null ? formatBytes(quota) : unlimitedLabel;
  const percent =
    quota != null && quota > 0 ? Math.min(100, (used / quota) * 100) : null;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-xs">
          {quota != null
            ? usedOfLabel(usedFmt, quotaFmt)
            : `${usedFmt} / ${unlimitedLabel}`}
        </span>
      </div>
      {percent != null && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              percent >= 90
                ? "bg-destructive"
                : percent >= 70
                  ? "bg-yellow-500"
                  : "bg-primary"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface StorageUsagePanelProps {
  treeId: string;
}

export function StorageUsagePanel({ treeId }: StorageUsagePanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "storage-usage" });
  const { usage, isLoading, refreshStorageUsage } = useStorageStore();

  useEffect(() => {
    void refreshStorageUsage(treeId);
  }, [treeId, refreshStorageUsage]);

  if (isLoading && !usage) {
    return (
      <div className="text-sm text-muted-foreground">{t("title")}…</div>
    );
  }

  if (!usage) return null;

  const unlimitedLabel = t("unlimited");
  const usedOfLabel = (used: string, quota: string) =>
    t("used-of", { used, quota });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("title")}</p>
      <UsageRow
        label={t("tree")}
        used={usage.tree_bytes}
        quota={usage.tree_quota_bytes}
        unlimitedLabel={unlimitedLabel}
        usedOfLabel={usedOfLabel}
      />
      <UsageRow
        label={t("media")}
        used={usage.media_bytes}
        quota={usage.media_quota_bytes}
        unlimitedLabel={unlimitedLabel}
        usedOfLabel={usedOfLabel}
      />
      <UsageRow
        label={t("total")}
        used={usage.total_bytes}
        quota={usage.total_quota_bytes}
        unlimitedLabel={unlimitedLabel}
        usedOfLabel={usedOfLabel}
      />
    </div>
  );
}
