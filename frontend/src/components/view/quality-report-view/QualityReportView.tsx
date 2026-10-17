import { useCallback, useEffect, useMemo, useState } from "react";
import { canEditArea } from "@/utils/accessLevels";
import { useTranslation } from "react-i18next";
import { Check, CheckCircle2, GitMerge, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { StatTile } from "@/components/shared/StatTile";
import { MemberChip } from "@/components/shared/MemberChip";
import { cn } from "@/lib/utils";
import type { Member } from "@/types/member";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useTaskStore } from "@/hooks/useTaskStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
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
  event_after_death: "issue-event-after-death",
};

/** Linked people as clickable chips; ids that no longer resolve are skipped. */
function PeopleChips({ ids }: { ids: string[] }) {
  const members = useMemberStore((s) => s.members);
  const openMember = useOpenMember();
  const people = ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => !!m);
  if (people.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((member) => (
        <MemberChip
          key={member.id}
          member={member}
          fullName
          onOpen={openMember}
        />
      ))}
    </div>
  );
}

function useOpenMember(): (memberId: string) => void {
  const workspaceId = useWorkspaceStore((state) => state.selectedTree?.id);
  const setOpenSheet = useMemberSheetStore((state) => state.setOpenSheet);
  const navigateTo = useNavigationStore((state) => state.navigateTo);

  return useCallback(
    (memberId: string) => {
      if (!workspaceId) return;
      setOpenSheet(workspaceId, { memberId, tab: "records", mode: "view" });
      navigateTo("tree-view");
    },
    [navigateTo, setOpenSheet, workspaceId],
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
  const { dismissIssue, restoreIssue } = useQualityReportStore();
  const [mergeOpen, setMergeOpen] = useState(false);

  const isDuplicate = issue.issue_type === "duplicate_candidate";
  const isError = issue.severity === "error";
  const typeLabel = t(ISSUE_TYPE_KEY[issue.issue_type] ?? "issue-unknown");

  return (
    <Card className={cn("gap-3 px-5", issue.dismissed && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isError ? "danger" : "info"}>
          {t(`severity-${issue.severity}`)}
        </Badge>
        <h3 className="text-[15px] font-bold">{typeLabel}</h3>
        {issue.dismissed && (
          <Badge variant="muted">{t("dismissed-badge")}</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{issue.description}</p>
      <PeopleChips ids={issue.member_ids} />
      {canWrite && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {issue.dismissed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => restoreIssue(issue.id)}
            >
              {t("restore")}
            </Button>
          ) : isDuplicate ? (
            <>
              <Button size="sm" onClick={() => setMergeOpen(true)}>
                <GitMerge />
                {t("merge-action")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dismissIssue(issue.id)}
              >
                {t("not-duplicate")}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dismissIssue(issue.id)}
            >
              {t("dismiss")}
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

function ResearchTasksCard({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "quality-report-view" });
  const { tasks, setTaskDone, refreshTasks, initialized } = useTaskStore();
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  useDeferredStoreLoad(initialized, refreshTasks);

  // Open tasks first, then the most recently finished few for context.
  const visible = useMemo(() => {
    const open = tasks.filter((task) => !task.done);
    const done = tasks
      .filter((task) => task.done)
      .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""))
      .slice(0, 3);
    return [...open, ...done];
  }, [tasks]);
  const openCount = tasks.filter((task) => !task.done).length;

  return (
    <Card className="gap-3 self-start">
      <CardHeader>
        <CardTitle>
          <h2>{t("open-tasks-title", { count: openCount })}</h2>
        </CardTitle>
        {canWrite && (
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setIsTaskDialogOpen(true)}
            >
              <Plus />
              {t("open-tasks-add")}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t("open-tasks-empty")}
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((task) => (
              <li key={task.id} className="flex items-start gap-3 py-3">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={task.done}
                  disabled={!canWrite}
                  title={task.done ? undefined : t("open-tasks-mark-done")}
                  aria-label={t(
                    task.done ? "open-tasks-mark-open" : "open-tasks-mark-done",
                  )}
                  onClick={() => void setTaskDone(task.id, !task.done)}
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border border-input bg-card transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50",
                    task.done &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {task.done && <Check className="size-3.5" />}
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      task.done && "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </p>
                  {task.notes && (
                    <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                      {task.notes}
                    </p>
                  )}
                  {task.linkedMemberIds.length > 0 ? (
                    <PeopleChips ids={task.linkedMemberIds} />
                  ) : (
                    <Badge variant="muted">{t("open-tasks-tree-level")}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {isTaskDialogOpen && (
        <TaskDialog
          open={isTaskDialogOpen}
          onOpenChange={setIsTaskDialogOpen}
        />
      )}
    </Card>
  );
}

export const QualityReportView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "quality-report-view",
  });
  const { report, isLoading, showDismissed, refreshReport, setShowDismissed } =
    useQualityReportStore();
  const tasks = useTaskStore((s) => s.tasks);
  const canWrite = useWorkspaceStore((s) =>
    canEditArea(s.selectedTree, "tree"),
  );
  const canWriteTasks = useWorkspaceStore((s) =>
    canEditArea(s.selectedTree, "tasks"),
  );
  const restrictions = useWorkspaceStore((s) => s.selectedTree?.restrictions);
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
  const openTaskCount = tasks.filter((task) => !task.done).length;
  const doneTaskCount = tasks.length - openTaskCount;

  const displayedIssues = showDismissed ? allIssues : activeIssues;
  const sortedIssues = [...displayedIssues].sort((a, b) => {
    if (a.dismissed !== b.dismissed) return a.dismissed ? 1 : -1;
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });

  return (
    <ViewLayout
      title={t("title")}
      subtitle={
        report ? t("subtitle", { count: report.total_members ?? 0 }) : undefined
      }
      action={
        <>
          {dismissedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={showDismissed}
                onCheckedChange={setShowDismissed}
              />
              {t("show-dismissed", { count: dismissedCount })}
            </label>
          )}
          <Button
            variant="outline"
            onClick={() => refreshReport()}
            disabled={isLoading}
          >
            <RefreshCw className={cn(isLoading && "animate-spin")} />
            {t("recheck")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 pb-4 md:grid-cols-3">
        <StatTile
          label={t("kpi-errors")}
          value={
            <span className={cn(errorCount > 0 && "text-destructive")}>
              {errorCount}
            </span>
          }
          note={t("kpi-errors-note")}
        />
        <StatTile
          label={t("kpi-warnings")}
          value={
            <span className={cn(warningCount > 0 && "text-warning")}>
              {warningCount}
            </span>
          }
          note={t("kpi-warnings-note")}
        />
        {tasksEnabled && (
          <StatTile
            label={t("kpi-tasks")}
            value={openTaskCount}
            note={t("kpi-tasks-note", { count: doneTaskCount })}
          />
        )}

        <section
          className={cn(
            "flex min-w-0 flex-col gap-3",
            tasksEnabled ? "md:col-span-2" : "md:col-span-3",
          )}
        >
          <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {t("issues-heading")}
          </h2>
          {isLoading && !report ? (
            <>
              <Skeleton className="h-36 rounded-2xl" />
              <Skeleton className="h-36 rounded-2xl" />
            </>
          ) : displayedIssues.length === 0 ? (
            <Card className="flex-row items-center gap-3 px-5">
              <CheckCircle2 className="size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">{t("no-issues")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("no-issues-description")}
                </p>
              </div>
            </Card>
          ) : (
            sortedIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} canWrite={canWrite} />
            ))
          )}
        </section>

        {tasksEnabled && (
          <div className="md:pt-7">
            <ResearchTasksCard canWrite={canWriteTasks} />
          </div>
        )}
      </div>
    </ViewLayout>
  );
};
