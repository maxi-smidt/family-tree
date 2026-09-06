import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import i18n from "@/i18n/i18n";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/dateUtils";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useNotificationStore } from "@/hooks/useNotificationStore";
import { FRIENDS_VIEW, MIGRATION_REVIEW_VIEW } from "@/lib/tabs";
import { NotificationDB } from "@/types/notification";

const MAX_BADGE_DISPLAY = 9;

/** Where (if anywhere) clicking a notification should take the user. */
function navigateForNotification(n: NotificationDB): void {
  switch (n.type) {
    case "friend_request_received":
    case "friend_request_accepted":
      useNavigationStore.getState().navigateTo(FRIENDS_VIEW);
      break;
    case "migration_report_ready":
    case "migration_conflict_pending":
      useNavigationStore.getState().navigateTo(MIGRATION_REVIEW_VIEW);
      break;
    case "tree_shared": {
      const workspaceId = String(n.payload?.workspace_id);
      const previousTree = useWorkspaceStore.getState().selectedTree;
      // Already there — nothing to navigate. Also avoids retrying the same
      // now-inaccessible tree below if access was revoked while it was open
      // (that retry would fail again and land on the same empty state).
      if (previousTree?.id === workspaceId) break;
      // The tree may since have been unshared or deleted — capture where
      // the user already was so a failed open can land them back there
      // instead of on whatever partial state the failed attempt left,
      // and tell them why nothing opened instead of failing silently.
      void useWorkspaceStore
        .getState()
        .openTreeById(workspaceId)
        .catch(() => {
          toast.error(i18n.t("tree-view.search.open-error"));
          const current = useWorkspaceStore.getState().selectedTree;
          if (previousTree && current?.id !== previousTree.id) {
            void useWorkspaceStore.getState().selectTree(previousTree);
          }
        });
      break;
    }
    default:
      // tree_unshared / invitation_received: nothing to navigate to, the
      // click above has already marked it read.
      break;
  }
}

export const NotificationBell = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "notifications" });
  const { t: tRoot } = useTranslation();
  const [open, setOpen] = useState(false);

  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const total = useNotificationStore((s) => s.total);
  const loadingMore = useNotificationStore((s) => s.loadingMore);
  const load = useNotificationStore((s) => s.load);
  const loadMore = useNotificationStore((s) => s.loadMore);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleItemClick = (n: NotificationDB) => {
    void markRead(n.id);
    navigateForNotification(n);
  };

  const badgeLabel =
    unreadCount > MAX_BADGE_DISPLAY
      ? `${MAX_BADGE_DISPLAY}+`
      : `${unreadCount}`;
  const triggerLabel =
    unreadCount > 0
      ? `${t("aria-label")} — ${t("unread-badge-label", { count: unreadCount })}`
      : t("aria-label");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 relative"
          aria-label={triggerLabel}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full px-1 py-0 text-[10px] leading-none"
            >
              {badgeLabel}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">{t("title")}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
            aria-label={t("mark-all-read")}
            title={t("mark-all-read")}
          >
            <CheckCheck className="size-4" />
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              {t("empty")}
            </p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleItemClick(n)}
                className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-accent transition-colors flex gap-2 items-start"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 rounded-full shrink-0",
                    n.read_at === null ? "bg-primary" : "bg-transparent",
                  )}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm leading-snug">
                    {tRoot(`notifications.types.${n.type}`, n.payload ?? {})}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {formatDate(n.created_at, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
              </button>
            ))
          )}
          {notifications.length < total && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full rounded-none"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {t("load-more")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
