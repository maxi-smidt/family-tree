import { useState } from "react";
import { toast } from "sonner";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useFeature } from "@/hooks/useAuthStore";
import { Activity, isUndoableDelete } from "@/types/activity";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { ListPagination } from "@/components/view/list-view/ListPagination";
import { Card } from "@/components/ui/card";
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
import { formatDateWithFallback } from "@/utils/dateUtils";
import { ApiError } from "@/services/api";
import {
  Clock,
  Activity as ActivityIcon,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  Loader2,
  Undo2,
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
  event: CalendarDays,
  task: ClipboardList,
  story: BookOpen,
  document: FileText,
  document_file: FileText,
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
    <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
      <span className="font-medium text-foreground">{t("diff-changed")}</span>
      {top.map((field) => (
        <div key={field} className="flex items-center gap-1 ml-2 flex-wrap">
          <span className="font-mono text-foreground/70">{field}</span>
          <span className="truncate max-w-[120px]">
            {String(before[field] ?? "")}
          </span>
          <span>{t("diff-arrow")}</span>
          <span className="truncate max-w-[120px]">
            {String(after[field] ?? "")}
          </span>
        </div>
      ))}
    </div>
  );
}

function ActivityItem({ item }: { item: Activity }) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "activity-view",
  });
  const { navigateTo } = useNavigationStore();
  const undo = useActivityStore((s) => s.undo);
  const undoEnabled = useFeature("activity_undo");
  const canWrite = useTreeStore((s) => s.selectedTree?.role !== "viewer");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const actor = item.actorUsername ?? t("unknown-actor");
  const action = t(ACTION_KEY[item.action] ?? "action-update");
  const targetType = t(TARGET_KEY[item.targetType] ?? item.targetType);
  const label = item.targetLabel ? `"${item.targetLabel}"` : "";

  const destinationView: ViewId | null = TARGET_VIEW[item.targetType] ?? null;
  const canNavigate = destinationView !== null;
  const TargetIcon = TARGET_ICONS[item.targetType] ?? ActivityIcon;
  const showUndo = undoEnabled && canWrite && isUndoableDelete(item);

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

  return (
    <Card
      className={`p-4 flex flex-row gap-4 items-center${canNavigate ? " group cursor-pointer hover:bg-muted/50 transition-colors" : ""}`}
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
      <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
        <TargetIcon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          <span className="font-medium">{actor}</span>{" "}
          <span className="text-muted-foreground">{action}</span>{" "}
          <span className="text-muted-foreground">{targetType}</span>
          {label && (
            <>
              {" "}
              <span className="font-medium truncate">{label}</span>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDateWithFallback(item.createdAt, i18n.t)}
        </p>
        {item.action === "update" && item.details && (
          <DiffDisplay details={item.details} />
        )}
      </div>
      {showUndo && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-shrink-0 gap-1 text-xs"
          disabled={undoing}
          onClick={(e) => {
            e.stopPropagation();
            setConfirmOpen(true);
          }}
        >
          <Undo2 className="w-3 h-3" />
          {t("undo")}
        </Button>
      )}
      {canNavigate && (
        <div
          className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
          title={t("navigate-hint")}
        >
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
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
              <AlertDialogAction disabled={undoing} onClick={() => void handleUndo()}>
                {t("undo-confirm-action")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

const ALL_ACTIONS = ["create", "update", "delete"] as const;
const ALL_TARGET_TYPES = [
  "member",
  "relation",
  "event",
  "story",
  "gallery_image",
  "document",
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
    initialized,
    loading,
    error,
  } = useActivityStore();
  useDeferredStoreLoad(initialized, refreshActivity);

  const hasActiveFilters = !!(filterActor || filterAction || filterTargetType);

  return (
    <ViewLayout
      title={t("title")}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter bar */}
          {/* Actor filter */}
          <Select
            value={filterActor || "__all__"}
            onValueChange={(v) =>
              void setFilter("filterActor", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("filter-all-actors")}</SelectItem>
              {actors.map((actor) => (
                <SelectItem key={actor} value={actor}>
                  {actor}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Action filter: toggle buttons */}
          <div className="flex gap-1">
            <Button
              variant={filterAction === "" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs px-3"
              onClick={() => void setFilter("filterAction", "")}
            >
              {t("filter-all-actions")}
            </Button>
            {ALL_ACTIONS.map((action) => (
              <Button
                key={action}
                variant={filterAction === action ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs px-3"
                onClick={() =>
                  void setFilter(
                    "filterAction",
                    filterAction === action ? "" : action,
                  )
                }
              >
                {t(ACTION_KEY[action])}
              </Button>
            ))}
          </div>

          {/* Target type filter */}
          <Select
            value={filterTargetType || "__all__"}
            onValueChange={(v) =>
              void setFilter("filterTargetType", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger className="h-8 w-36 text-xs">
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

          {/* Clear filters button */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => void clearFilters()}
            >
              <X className="w-3 h-3" />
              {t("filter-clear")}
            </Button>
          )}
        </div>
      }
      toolbarClassName="mb-4"
      contentClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {error && activities.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <ActivityIcon className="w-10 h-10 text-destructive opacity-60" />
            <div>
              <p className="font-medium">{t("error")}</p>
              <Button className="mt-3" size="sm" onClick={() => void retry()}>
                {t("retry")}
              </Button>
            </div>
          </div>
        ) : loading && !initialized ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <ActivityIcon className="w-10 h-10 text-muted-foreground opacity-40" />
            <div>
              <p className="font-medium">
                {hasActiveFilters ? t("filter-no-matches") : t("empty-title")}
              </p>
              {!hasActiveFilters && (
                <p className="text-sm text-muted-foreground mt-1">
                  {t("empty-description")}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col gap-3 pb-4 transition-opacity",
              loading && "opacity-60",
            )}
          >
            {activities.map((item) => (
              <ActivityItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {error && activities.length > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{t("error")}</span>
          <Button variant="outline" size="sm" onClick={() => void retry()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {initialized && total > 0 && (
        <div className="flex-none border-t">
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
