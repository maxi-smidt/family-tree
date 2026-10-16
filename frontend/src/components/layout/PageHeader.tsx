import { ReactNode } from "react";
import { SidebarTrigger, useOptionalSidebar } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { useHasMobileTabBar } from "@/components/layout/MobileTabBar";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /** Quiet context next to the title, e.g. "17 people · 4 generations". */
  subtitle?: ReactNode;
  /** Page-level actions, right-aligned before the notification bell. */
  actions?: ReactNode;
  /**
   * Replaces the visible title (which stays as the page's h1 for screen
   * readers), e.g. the workspace switcher on the phone tree.
   */
  heading?: ReactNode;
  /** Keep the actions on the title row on phones (icon buttons). */
  inlineActions?: boolean;
  className?: string;
}

/**
 * The top bar every main view shares: sidebar toggle, page title, optional
 * subtitle and actions, and the notification bell. Replaces the old floating
 * trigger/bell that each view had to leave room for with ml-16 / pr-12.
 */
export const PageHeader = ({
  title,
  subtitle,
  actions,
  heading,
  inlineActions = false,
  className,
}: PageHeaderProps) => {
  // Views are also rendered on their own (tests, embedded screens) where no
  // sidebar exists — only offer the toggle when there is one to toggle.
  const hasSidebar = useOptionalSidebar() !== null;
  const hasWorkspace = useWorkspaceStore((s) => !!s.selectedTree);
  // Phones with a workspace navigate from the bottom tab bar instead.
  const hasTabBar = useHasMobileTabBar();
  return (
    <header
      className={cn(
        "flex min-h-16 flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-3 py-3 md:px-5",
        className,
      )}
    >
      {hasSidebar && !hasTabBar && (
        <SidebarTrigger
          className="size-9 text-muted-foreground"
          data-tutorial="views-tabs-mobile"
        />
      )}
      {heading ? (
        <div className="flex min-w-0 flex-1 items-center">
          <h1 className="sr-only">{title}</h1>
          {heading}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">
            {title}
          </h1>
          {subtitle && (
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">
              {subtitle}
            </span>
          )}
        </div>
      )}
      {hasSidebar && hasWorkspace && <GlobalSearch />}
      {actions && (
        // On phones the page actions drop to their own row under the title
        // so the title never truncates to a letter.
        <div
          className={cn(
            "flex flex-wrap items-center gap-2",
            !inlineActions &&
              "max-sm:order-last max-sm:w-full [&>*]:max-sm:flex-1 sm:[&>*]:flex-none",
          )}
        >
          {actions}
        </div>
      )}
      {hasSidebar && <NotificationBell />}
    </header>
  );
};
