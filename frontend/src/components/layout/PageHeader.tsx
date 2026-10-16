import { ReactNode } from "react";
import { SidebarTrigger, useOptionalSidebar } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /** Quiet context next to the title, e.g. "17 people · 4 generations". */
  subtitle?: ReactNode;
  /** Page-level actions, right-aligned before the notification bell. */
  actions?: ReactNode;
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
  className,
}: PageHeaderProps) => {
  // Views are also rendered on their own (tests, embedded screens) where no
  // sidebar exists — only offer the toggle when there is one to toggle.
  const hasSidebar = useOptionalSidebar() !== null;
  return (
    <header
      className={cn(
        "flex min-h-16 flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-3 py-3 md:px-5",
        className,
      )}
    >
      {hasSidebar && (
        <SidebarTrigger
          className="text-muted-foreground"
          data-tutorial="views-tabs-mobile"
        />
      )}
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
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
      {hasSidebar && <NotificationBell />}
    </header>
  );
};
