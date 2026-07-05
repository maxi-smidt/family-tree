import {
  useActivityStore,
  selectFilteredActivities,
} from "@/hooks/useActivityStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { Activity } from "@/types/activity";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { formatDateWithFallback } from "@/utils/dateUtils";
import { Clock, Activity as ActivityIcon, ArrowRight, X } from "lucide-react";

type ViewId =
  | "tree-view"
  | "list-view"
  | "gallery-view"
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
  gallery_image: "target-gallery_image",
  disease: "target-disease",
  tree: "target-tree",
  share: "target-share",
  import: "target-import",
  merge: "target-merge",
};

const TARGET_VIEW: Record<string, ViewId> = {
  member: "tree-view",
  event: "timeline-view",
  story: "list-view",
  gallery_image: "gallery-view",
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

  const actor = item.actorUsername ?? t("unknown-actor");
  const action = t(ACTION_KEY[item.action] ?? "action-update");
  const targetType = t(TARGET_KEY[item.targetType] ?? item.targetType);
  const label = item.targetLabel ? `"${item.targetLabel}"` : "";

  const destinationView: ViewId | null = TARGET_VIEW[item.targetType] ?? null;
  const canNavigate = destinationView !== null;

  const handleNavigate = () => {
    if (canNavigate) {
      navigateTo(destinationView);
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
        <ActivityIcon className="w-4 h-4 text-muted-foreground" />
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
      {canNavigate && (
        <div
          className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
          title={t("navigate-hint")}
        >
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </div>
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
  "disease",
  "tree",
  "share",
  "import",
  "merge",
] as const;

export const ActivityView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "activity-view" });
  const store = useActivityStore();
  const filteredActivities = selectFilteredActivities(store);
  const {
    filterActor,
    filterAction,
    filterTargetType,
    setFilter,
    activities,
    refreshActivity,
    initialized,
  } = store;
  useDeferredStoreLoad(initialized, refreshActivity);

  const uniqueActors = Array.from(
    new Set(activities.map((a) => a.actorUsername).filter(Boolean)),
  ) as string[];

  const hasActiveFilters = !!(filterActor || filterAction || filterTargetType);

  const clearFilters = () => {
    setFilter("filterActor", "");
    setFilter("filterAction", "");
    setFilter("filterTargetType", "");
  };

  return (
    <ViewLayout title={t("title")}>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {/* Actor filter */}
        <Select
          value={filterActor || "__all__"}
          onValueChange={(v) =>
            setFilter("filterActor", v === "__all__" ? "" : v)
          }
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("filter-all-actors")}</SelectItem>
            {uniqueActors.map((actor) => (
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
            onClick={() => setFilter("filterAction", "")}
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
                setFilter("filterAction", filterAction === action ? "" : action)
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
            setFilter("filterTargetType", v === "__all__" ? "" : v)
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
            onClick={clearFilters}
          >
            <X className="w-3 h-3" />
            {t("filter-clear")}
          </Button>
        )}
      </div>

      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
          <ActivityIcon className="w-10 h-10 text-muted-foreground opacity-40" />
          <div>
            <p className="font-medium">{t("empty-title")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("empty-description")}
            </p>
          </div>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <ActivityIcon className="w-8 h-8 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">{t("filter-clear")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          {filteredActivities.map((item) => (
            <ActivityItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </ViewLayout>
  );
};
