/**
 * Displays the selected tree owner's combined storage usage. Workspace data and
 * media each show usage against their quota (the ∞ symbol when the quota is
 * null/unlimited); the total is just the reported sum of the two, with no
 * quota of its own.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStorageStore } from "@/hooks/useStorageStore";
import { SidebarGroupLabel } from "@/components/ui/sidebar";

// Unit suffixes are identical across the supported locales; only the number
// (decimal separator/grouping) is localised via Intl.NumberFormat.
function formatBytes(bytes: number, locale: string): string {
  const fmt = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
      value,
    );
  if (bytes < 1024) return `${fmt(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmt(bytes / (1024 * 1024), 1)} MB`;
  return `${fmt(bytes / (1024 * 1024 * 1024), 2)} GB`;
}

interface UsageRowProps {
  label: string;
  used: number;
  quota: number | null;
  locale: string;
  unlimitedLabel: string;
  usedOfLabel: (used: string, quota: string) => string;
}

function UsageRow({
  label,
  used,
  quota,
  locale,
  unlimitedLabel,
  usedOfLabel,
}: UsageRowProps) {
  const usedFmt = formatBytes(used, locale);
  const isUnlimited = quota == null;
  const quotaFmt = isUnlimited ? "∞" : formatBytes(quota, locale);
  const percent =
    !isUnlimited && quota > 0 ? Math.min(100, (used / quota) * 100) : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className="text-xs tabular-nums"
          title={isUnlimited ? unlimitedLabel : undefined}
        >
          {usedOfLabel(usedFmt, quotaFmt)}
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
  workspaceId: string;
}

export function StorageUsagePanel({ workspaceId }: StorageUsagePanelProps) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "storage-usage" });
  const { usage, isLoading, error, refreshStorageUsage } = useStorageStore();

  useEffect(() => {
    void refreshStorageUsage(workspaceId);
  }, [workspaceId, refreshStorageUsage]);

  if (isLoading && !usage) {
    return (
      <div className="px-2 text-xs text-muted-foreground">{t("title")}…</div>
    );
  }

  if (error && !usage) {
    return <div className="px-2 text-xs text-destructive">{t("error")}</div>;
  }

  if (!usage) return null;

  const locale = i18n.language;
  const unlimitedLabel = t("unlimited");
  const usedOfLabel = (used: string, quota: string) =>
    t("used-of", { used, quota });

  return (
    <div className="mb-3">
      <SidebarGroupLabel>{t("title")}</SidebarGroupLabel>
      <div className="flex flex-col gap-2 px-3 py-2">
        <UsageRow
          label={t("workspace")}
          used={usage.tree_bytes}
          quota={usage.tree_quota_bytes}
          locale={locale}
          unlimitedLabel={unlimitedLabel}
          usedOfLabel={usedOfLabel}
        />
        <UsageRow
          label={t("media")}
          used={usage.media_bytes}
          quota={usage.media_quota_bytes}
          locale={locale}
          unlimitedLabel={unlimitedLabel}
          usedOfLabel={usedOfLabel}
        />
        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border pt-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("total")}
          </span>
          <span className="text-xs font-medium tabular-nums">
            {formatBytes(usage.total_bytes, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}
