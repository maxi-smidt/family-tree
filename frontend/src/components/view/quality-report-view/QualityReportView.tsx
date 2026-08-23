import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Circle,
  ClipboardList,
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  GitMerge,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { ApiError } from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useTaskStore } from "@/hooks/useTaskStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { TaskDialog } from "@/components/shared/member-sheet/TaskDialog";
import { MergeMembersDialog } from "@/components/view/quality-report-view/MergeMembersDialog";
import type { QualityIssue } from "@/types/quality";

const ISSUE_TYPE_KEY: Record<string, string> = {
  birth_after_death: "issue-birth-after-death",
  child_older_than_parent: "issue-child-older-than-parent",
  child_after_parent_death: "issue-child-after-parent-death",
  parent_too_young: "issue-parent-too-young",
  parent_too_old: "issue-parent-too-old",
  relationship_cycle: "issue-relationship-cycle",
  duplicate_candidate: "issue-duplicate-candidate",
  disconnected_member: "issue-disconnected-member",
  bridge_person_drift: "issue-bridge-person-drift",
  event_after_death: "issue-event-after-death",
};

function memberLabel(
  memberId: string,
  members: ReturnType<typeof useMemberStore.getState>["members"],
): string {
  const m = members.find((x) => x.id === memberId);
  if (!m) return memberId;
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
  return name || memberId;
}

function useOpenMember(): (memberId: string) => void {
  const treeId = useTreeStore((state) => state.selectedTree?.id);
  const setOpenSheet = useMemberSheetStore((state) => state.setOpenSheet);
  const navigateTo = useNavigationStore((state) => state.navigateTo);

  return useCallback(
    (memberId: string) => {
      if (!treeId) return;
      setOpenSheet(treeId, { memberId, tab: "records", mode: "view" });
      navigateTo("tree-view");
    },
    [navigateTo, setOpenSheet, treeId],
  );
}

function IssueCard({
  issue,
  canWrite,
}: {
  issue: QualityIssue;
  canWrite: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "quality-report-view" });
  const { members } = useMemberStore();
  const openMember = useOpenMember();
  const { dismissIssue, restoreIssue, resolveBridgeDrift } =
    useQualityReportStore();
  const [resolving, setResolving] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Bridge-person drift is directly fixable from the note: adopt one side.
  // Requires write access to the linked tree too — the backend answers 403
  // otherwise, surfaced as a dedicated toast.
  const isBridgeDrift = issue.issue_type === "bridge_person_drift";
  const isDuplicate = issue.issue_type === "duplicate_candidate";
  const handleResolveDrift = async (direction: "push" | "pull") => {
    setResolving(true);
    try {
      await resolveBridgeDrift(issue.member_ids[0], direction);
      toast.success(t("resolve-drift-success"));
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error(t("resolve-drift-no-access"));
      } else {
        toast.error(t("resolve-drift-error"));
      }
    } finally {
      setResolving(false);
    }
  };

  const isError = issue.severity === "error";
  const Icon = isError ? AlertCircle : AlertTriangle;
  const iconClass = isError
    ? "text-destructive"
    : "text-yellow-500 dark:text-yellow-400";
  const typeLabel = t(ISSUE_TYPE_KEY[issue.issue_type] ?? "issue-unknown");

  return (
    <Card
      className={`p-4 flex flex-row gap-4 items-center ${issue.dismissed ? "opacity-60" : ""}`}
    >
      <div className="mt-0.5 flex-shrink-0">
        <Icon className={`w-5 h-5 ${iconClass}`} />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{typeLabel}</span>
          <Badge
            variant={isError ? "destructive" : "outline"}
            className="text-xs"
          >
            {t(`severity-${issue.severity}`)}
          </Badge>
          {issue.dismissed && (
            <Badge variant="secondary" className="text-xs">
              {t("dismissed-badge")}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{issue.description}</p>
        {issue.member_ids.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {issue.member_ids.map((id) => (
              <button
                key={id}
                className="text-xs px-2 py-0.5 rounded-full bg-muted hover:bg-muted/70 transition-colors font-mono cursor-pointer"
                onClick={() => openMember(id)}
                title={t("view-member")}
              >
                {memberLabel(id, members)}
              </button>
            ))}
          </div>
        )}
        {isBridgeDrift && canWrite && !issue.dismissed && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={resolving}
              onClick={() => void handleResolveDrift("push")}
            >
              <ArrowUpFromLine />
              {t("resolve-drift-push")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={resolving}
              onClick={() => void handleResolveDrift("pull")}
            >
              <ArrowDownToLine />
              {t("resolve-drift-pull")}
            </Button>
          </div>
        )}
        {isDuplicate && canWrite && !issue.dismissed && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMergeOpen(true)}
            >
              <GitMerge />
              {t("merge-action")}
            </Button>
          </div>
        )}
      </div>
      {canWrite && (
        <div className="flex-shrink-0">
          {issue.dismissed ? (
            <Button
              variant="ghost"
              size="icon"
              title={t("restore")}
              onClick={() => restoreIssue(issue.id)}
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              title={t("dismiss")}
              onClick={() => dismissIssue(issue.id)}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
      {isDuplicate && mergeOpen && (
        <MergeMembersDialog
          memberIds={issue.member_ids}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          onMerged={() => {}}
        />
      )}
    </Card>
  );
}

function OpenTasksSection({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "quality-report-view" });
  const { members } = useMemberStore();
  const openMember = useOpenMember();
  const { tasks, setTaskDone, refreshTasks, initialized } = useTaskStore();
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  useDeferredStoreLoad(initialized, refreshTasks);

  const openTasks = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  if (openTasks.length === 0 && !canWrite) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">
            {t("open-tasks-title", { count: openTasks.length })}
          </h3>
        </div>
        {canWrite && (
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => setIsTaskDialogOpen(true)}
          >
            <Plus />
            {t("open-tasks-add")}
          </Button>
        )}
      </div>
      {openTasks.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          {t("open-tasks-empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {openTasks.map((task) => (
            <Card
              key={task.id}
              className="p-3 flex flex-row gap-3 items-center"
            >
              {canWrite ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0"
                  title={t("open-tasks-mark-done")}
                  onClick={() => void setTaskDone(task.id, true)}
                >
                  <Circle className="w-4 h-4 text-muted-foreground" />
                </Button>
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-2" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{task.title}</p>
                {task.notes && (
                  <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
                    {task.notes}
                  </p>
                )}
              </div>
              {task.linkedMemberIds.length > 0 ? (
                <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
                  {task.linkedMemberIds.map((memberId) => (
                    <button
                      key={memberId}
                      className="text-xs px-2 py-0.5 rounded-full bg-muted hover:bg-muted/70 transition-colors font-mono cursor-pointer"
                      onClick={() => openMember(memberId)}
                      title={t("view-member")}
                    >
                      {memberLabel(memberId, members)}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
                  {t("open-tasks-tree-level")}
                </span>
              )}
            </Card>
          ))}
        </div>
      )}
      {isTaskDialogOpen && (
        <TaskDialog
          open={isTaskDialogOpen}
          onOpenChange={setIsTaskDialogOpen}
        />
      )}
    </div>
  );
}

export const QualityReportView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "quality-report-view",
  });
  const { report, isLoading, showDismissed, refreshReport, setShowDismissed } =
    useQualityReportStore();
  const canWrite = useTreeStore((s) => s.selectedTree?.role !== "viewer");
  const restrictions = useTreeStore((s) => s.selectedTree?.restrictions);
  const tasksEnabled = !restrictions?.includes("tasks");

  useEffect(() => {
    if (!report) {
      refreshReport();
    }
  }, [report, refreshReport]);

  const allIssues = report?.issues ?? [];
  const activeIssues = allIssues.filter((i) => !i.dismissed);
  const dismissedCount = allIssues.length - activeIssues.length;
  const errorCount = activeIssues.filter((i) => i.severity === "error").length;
  const warningCount = activeIssues.filter(
    (i) => i.severity === "warning",
  ).length;

  const displayedIssues = showDismissed ? allIssues : activeIssues;
  const sortedIssues = [...displayedIssues].sort((a, b) => {
    if (a.dismissed !== b.dismissed) return a.dismissed ? 1 : -1;
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });

  return (
    <ViewLayout
      title={t("title")}
      action={
        dismissedCount > 0 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            {t("show-dismissed", { count: dismissedCount })}
            <Switch
              checked={showDismissed}
              onCheckedChange={setShowDismissed}
            />
          </label>
        ) : undefined
      }
    >
      {tasksEnabled && <OpenTasksSection canWrite={canWrite} />}

      {activeIssues.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              {t("count-errors", { count: errorCount })}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-sm text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="w-4 h-4" />
              {t("count-warnings", { count: warningCount })}
            </span>
          )}
        </div>
      )}

      {isLoading && !report ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      ) : displayedIssues.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            {report ? (
              <CheckCircle2 className="w-7 h-7 text-green-500" />
            ) : (
              <ShieldCheck className="w-7 h-7 text-muted-foreground opacity-40" />
            )}
          </div>
          <div>
            <p className="font-medium">{t("no-issues")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("no-issues-description")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          {sortedIssues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} canWrite={canWrite} />
          ))}
        </div>
      )}
    </ViewLayout>
  );
};
