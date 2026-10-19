import { useState } from "react";
import { toast } from "sonner";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { Activity, isUndoableDelete } from "@/types/activity";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { ListPagination } from "@/components/view/list-view/ListPagination";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { resolveDateLocale } from "@/utils/dateUtils";
import { ApiError } from "@/services/api";
import {
  Activity as ActivityIcon,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  GitMerge,
  Image as ImageIcon,
  Link2,
  Share2,
  Stethoscope,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  X,
} from "lucide-react";

type ViewId =
  | "tree-view"
  | "list-view"
  | "media-view"
  | "timeline-view"
  | "activity-view"
  | "quality-report-view"
  | "database-management-view";

const ACTION_KEY: Record<string, string> = {
  create: "action-create",
  update: "action-update",
  delete: "action-delete",
  send_to_ai: "action-send-to-ai",
};

const TARGET_KEY: Record<string, string> = {
  member: "target-member",
  relation: "target-relation",
  event: "target-event",
  story: "target-story",
  task: "target-task",
  gallery_image: "target-gallery_image",
  document: "target-document",
  document_file: "target-document_file",
  disease: "target-disease",
  tree: "target-tree",
  share: "target-share",
  import: "target-import",
  merge: "target-merge",
};

const TARGET_VIEW: Record<string, ViewId> = {
  member: "tree-view",
  event: "timeline-view",
  story: "timeline-view",
  gallery_image: "media-view",
};

const TARGET_ICONS: Record<string, typeof ActivityIcon> = {
  member: UserRound,
  relation: Link2,
  event: CalendarDays,
  task: ClipboardList,
  story: BookOpen,
  gallery_image: ImageIcon,
  document: FileText,
  document_file: FileText,
  disease: Stethoscope,
  share: Share2,
  import: Upload,
  merge: GitMerge,
};

/** Icon tile tint per target, so a day's feed scans by kind of change. */
const TARGET_TONE: Record<string, string> = {
  member: "bg-primary-soft text-primary",
  relation: "bg-primary-soft text-primary",
  event: "bg-warning-soft text-warning",
  story: "bg-primary-soft text-primary",
  gallery_image: "bg-gender-f-bg text-gender-f",
  document: "bg-warning-soft text-warning",
  document_file: "bg-warning-soft text-warning",
  share: "bg-gender-m-bg text-gender-m",
};

// Fields we do not want to surface in the diff.
const SKIP_DIFF_FIELDS = new Set([
  "positionX",
  "positionY",
  "isCollapsed",
  "imageData",
]);

function DiffDisplay({ details }: { details: Record<string, unknown> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "activity-view" });

  const before = details.before as Record<string, unknown> | undefined;
  const after = details.after as Record<string, unknown> | undefined;
  if (!before || !after) return null;

  const changedFields = Object.keys(before).filter(
    (k) => !SKIP_DIFF_FIELDS.has(k) && before[k] !== after[k],
  );
  const top = changedFields.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <span className="sr-only">{t("diff-changed")}</span>
      {top.map((field) => (
        <Badge key={field} variant="muted" className="max-w-full font-normal">
          <span className="font-semibold">{field}</span>
          <span className="max-w-[10rem] truncate">
            {String(before[field] ?? "—")}
          </span>
          <span aria-hidden="true">{t("diff-arrow")}</span>
          <span className="max-w-[10rem] truncate">
            {String(after[field] ?? "—")}
          </span>
        </Badge>
      ))}
    </div>
  );
}

function ActivityItem({ item }: { item: Activity }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "activity-view",
  });
  const { navigateTo } = useNavigationStore();
  const undo = useActivityStore((s) => s.undo);
  const canWrite = useWorkspaceStore((s) => s.selectedTree?.role !== "viewer");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const actor = item.actorUsername ?? t("unknown-actor");
  const action = t(ACTION_KEY[item.action] ?? "action-update");
  const targetType = t(TARGET_KEY[item.targetType] ?? item.targetType);
  const label = item.targetLabel ? `"${item.targetLabel}"` : "";

  const destinationView: ViewId | null = TARGET_VIEW[item.targetType] ?? null;
  const canNavigate = destinationView !== null;
  const TargetIcon = TARGET_ICONS[item.targetType] ?? ActivityIcon;
  const showUndo = canWrite && isUndoableDelete(item);

  const handleNavigate = () => {
    if (canNavigate) {
      navigateTo(destinationView);
    }
  };

  const handleUndo = async () => {
    setUndoing(true);
    try {
      const report = await undo(item.id);
      if (report.skipped.length > 0) {
        toast.warning(t("undo-partial", { count: report.skipped.length }));
      } else {
        toast.success(t("undo-success"));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error(t("undo-conflict"));
      } else if (error instanceof ApiError && error.status === 422) {
        toast.error(t("undo-invalid"));
      } else {
        toast.error(t("undo-error"));
      }
    } finally {
      setUndoing(false);
    }
  };

  const time = new Intl.DateTimeFormat(resolveDateLocale(), {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(item.createdAt));

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-5 py-3.5",
        canNavigate &&
          "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
      )}
      onClick={canNavigate ? handleNavigate : undefined}
      role={canNavigate ? "button" : undefined}
      tabIndex={canNavigate ? 0 : undefined}
      onKeyDown={
        canNavigate
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleNavigate();
              }
            }
          : undefined
      }
      aria-label={
        canNavigate
          ? `${actor} ${action} ${targetType}${label ? ` ${label}` : ""} — ${t("navigate-hint")}`
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          TARGET_TONE[item.targetType] ?? "bg-muted text-muted-foreground",
        )}
      >
        <TargetIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold">{actor}</span>{" "}
          <span className="text-muted-foreground">
            {action} {targetType}
          </span>
          {item.targetLabel && (
            <>
              {" "}
              <span
                className={cn(
                  "font-medium",
                  canNavigate &&
                    "text-primary underline decoration-primary/30 underline-offset-2",
                )}
              >
                {item.targetLabel}
              </span>
            </>
          )}
        </p>
        {item.action === "update" && item.details && (
          <DiffDisplay details={item.details} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1">
        {showUndo && (
          <Button
            variant="outline"
            size="sm"
            disabled={undoing}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
          >
            <Undo2 />
            {t("undo")}
          </Button>
        )}
        <time
          dateTime={item.createdAt}
          className="text-xs text-muted-foreground tabular-nums"
        >
          {time}
        </time>
      </div>
      {showUndo && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("undo-confirm-title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("undo-confirm-body")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("undo-cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={undoing}
                onClick={() => void handleUndo()}
              >
                {t("undo-confirm-action")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}

/** "Today", "Yesterday", or the full weekday date — the feed's day headings. */
function dayLabel(iso: string, t: (k: string) => string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (diffDays === 0) return t("day-today");
  if (diffDays === 1) return t("day-yesterday");
  return new Intl.DateTimeFormat(resolveDateLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

const ALL_ACTIONS = ["create", "update", "delete", "send_to_ai"] as const;
const ALL_TARGET_TYPES = [
  "member",
  "relation",
  "event",
  "story",
  "gallery_image",
  "document",
  "document_file",
  "disease",
  "tree",
  "share",
  "import",
  "merge",
] as const;

export const ActivityView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "activity-view" });
  const {
    activities,
    actors,
    total,
    page,
    pageSize,
    filterActor,
    filterAction,
    filterTargetType,
    setFilter,
    clearFilters,
    setPage,
    setPageSize,
    refreshActivity,
    retry,
    clearActivities,
    initialized,
    loading,
    error,
  } = useActivityStore();
  useDeferredStoreLoad(initialized, refreshActivity);
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const isOwner = selectedTree?.role === "owner";
  const [clearWorkspaceId, setClearWorkspaceId] = useState<string | null>(null);
  const clearOpen = isOwner && clearWorkspaceId === selectedTree?.id;
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    if (!clearWorkspaceId) return;
    setClearing(true);
    try {
      await clearActivities(clearWorkspaceId);
      toast.success(t("clear-success"));
      setClearWorkspaceId(null);
    } catch {
      toast.error(t("clear-error"));
    } finally {
      setClearing(false);
    }
  };

  const hasActiveFilters = !!(filterActor || filterAction || filterTargetType);

  // Group the current page into days (the API returns newest first).
  const days: { key: string; label: string; items: Activity[] }[] = [];
  for (const item of activities) {
    const d = new Date(item.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, label: dayLabel(item.createdAt, t), items: [item] });
  }

  return (
    <ViewLayout
      title={t("title")}
      subtitle={t("subtitle")}
      action={
        isOwner ? (
          <Button
            variant="outline"
            disabled={clearing}
            onClick={() => setClearWorkspaceId(selectedTree.id)}
          >
            <Trash2 />
            {t("clear")}
          </Button>
        ) : undefined
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="chip"
            size="sm"
            spacing={2}
            className="flex-wrap"
            value={filterAction || "all"}
            onValueChange={(v) =>
              v && void setFilter("filterAction", v === "all" ? "" : v)
            }
            aria-label={t("filter-action-label")}
          >
            <ToggleGroupItem value="all">
              {t("filter-all-actions")}
            </ToggleGroupItem>
            {ALL_ACTIONS.map((action) => (
              <ToggleGroupItem key={action} value={action}>
                {t(`chip-${action}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={filterTargetType || "__all__"}
            onValueChange={(v) =>
              void setFilter("filterTargetType", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger
              size="sm"
              className="w-40"
              aria-label={t("filter-type-label")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("filter-all-types")}</SelectItem>
              {ALL_TARGET_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(TARGET_KEY[type])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void clearFilters()}
            >
              <X />
              {t("filter-clear")}
            </Button>
          )}
          <div className="hidden flex-1 sm:block" />
          <Select
            value={filterActor || "__all__"}
            onValueChange={(v) =>
              void setFilter("filterActor", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger
              size="sm"
              className="w-44"
              aria-label={t("filter-actor-label")}
            >
              <span className="flex min-w-0 items-center gap-2">
                <UserRound className="size-4 text-muted-foreground" />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="__all__">{t("filter-all-actors")}</SelectItem>
              {actors.map((actor) => (
                <SelectItem key={actor} value={actor}>
                  {actor}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      contentClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <AlertDialog
        open={clearOpen}
        onOpenChange={(open) => !open && !clearing && setClearWorkspaceId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clear-confirm-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("clear-confirm-body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>
              {t("undo-cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={clearing}
              onClick={(event) => {
                event.preventDefault();
                void handleClear();
              }}
            >
              {t("clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {error && activities.length === 0 ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ActivityIcon className="text-destructive" />
              </EmptyMedia>
              <EmptyTitle>{t("error")}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => void retry()}>
                {t("retry")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : loading && !initialized ? (
          <div className="max-w-3xl space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        ) : total === 0 ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ActivityIcon />
              </EmptyMedia>
              <EmptyTitle>
                {hasActiveFilters ? t("filter-no-matches") : t("empty-title")}
              </EmptyTitle>
              {!hasActiveFilters && (
                <EmptyDescription>{t("empty-description")}</EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            className={cn(
              "flex max-w-3xl flex-col gap-5 pb-4 transition-opacity",
              loading && "opacity-60",
            )}
          >
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <h2 className="mb-2 text-[13px] font-semibold text-muted-foreground">
                  {day.label}
                </h2>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
                  {day.items.map((item) => (
                    <ActivityItem key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {error && activities.length > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">
          <span>{t("error")}</span>
          <Button variant="outline" size="sm" onClick={() => void retry()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {initialized && total > 0 && (
        <div className="max-w-3xl flex-none">
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={(p) => void setPage(p)}
            onPageSizeChange={(s) => void setPageSize(s)}
          />
        </div>
      )}
    </ViewLayout>
  );
};
