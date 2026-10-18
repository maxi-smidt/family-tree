import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useNavEntries, type NavEntry } from "@/hooks/useNavEntries";
import { cn } from "@/lib/utils";

/** The four destinations a phone keeps one tap away; the rest live in More. */
const PRIMARY_KEYS = ["tree-view", "list-view", "timeline-view"];
const MEDIA_KEYS = ["media-gallery", "media-documents"];

/**
 * Phones show a bottom tab bar instead of the sidebar toggle once a
 * workspace is open. Without a workspace there is nothing to switch between,
 * so the header keeps its menu button.
 */
export function useHasMobileTabBar() {
  const isMobile = useIsMobile();
  const hasSidebar = useOptionalSidebar() !== null;
  const hasWorkspace = useWorkspaceStore((s) => !!s.selectedTree);
  return isMobile && hasSidebar && hasWorkspace;
}

const TAB =
  "relative flex min-h-13 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-5";

export function MobileTabBar() {
  const { t } = useTranslation(undefined, { keyPrefix: "layout.nav" });
  const sidebar = useOptionalSidebar();
  const { groups, open, isActive } = useNavEntries();
  const entries = groups.flatMap((g) => g.entries);

  const media = MEDIA_KEYS.map((key) =>
    entries.find((e) => e.key === key),
  ).find((e): e is NavEntry => !!e);
  const primary = [
    ...PRIMARY_KEYS.map((key) => entries.find((e) => e.key === key)),
    media,
  ].filter((e): e is NavEntry => !!e);

  const moreActive = !primary.some(isActive);
  const moreBadge = entries
    .filter((e) => !primary.includes(e))
    .reduce((sum, e) => sum + (e.badge ?? 0), 0);

  return (
    <nav
      aria-label={t("tab-bar")}
      data-tutorial="views-tabs-mobile"
      className="flex flex-none border-t bg-card px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
    >
      {primary.map((entry) => {
        const Icon = entry.icon;
        const active = isActive(entry);
        return (
          <button
            key={entry.key}
            type="button"
            aria-current={active ? "page" : undefined}
            className={cn(TAB, active && "text-primary")}
            onClick={() => open(entry)}
          >
            <Icon aria-hidden="true" />
            <span className="max-w-full truncate">{entry.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={sidebar?.openMobile ?? false}
        aria-current={moreActive ? "page" : undefined}
        className={cn(TAB, moreActive && "text-primary")}
        onClick={() => sidebar?.setOpenMobile(true)}
      >
        <Menu aria-hidden="true" />
        <span>{t("more")}</span>
        {moreBadge > 0 && (
          <span
            aria-label={t("more-badge", { count: moreBadge })}
            className="absolute top-1.5 left-1/2 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-warning-soft px-1 text-[10px] font-semibold text-warning tabular-nums ring-2 ring-card"
          >
            {moreBadge}
          </span>
        )}
      </button>
    </nav>
  );
}
