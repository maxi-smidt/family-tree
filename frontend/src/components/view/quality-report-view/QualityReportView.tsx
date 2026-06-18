import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import type { QualityIssue } from "@/types/quality";

const ISSUE_TYPE_KEY: Record<string, string> = {
  birth_after_death: "issue-birth-after-death",
  child_older_than_parent: "issue-child-older-than-parent",
  parent_too_young: "issue-parent-too-young",
  parent_too_old: "issue-parent-too-old",
  relationship_cycle: "issue-relationship-cycle",
  duplicate_candidate: "issue-duplicate-candidate",
  disconnected_member: "issue-disconnected-member",
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

function IssueCard({ issue }: { issue: QualityIssue }) {
  const { t } = useTranslation(undefined, { keyPrefix: "quality-report-view" });
  const { members } = useMemberStore();
  const { navigateTo } = useNavigationStore();

  const isError = issue.severity === "error";
  const Icon = isError ? AlertCircle : AlertTriangle;
  const iconClass = isError
    ? "text-destructive"
    : "text-yellow-500 dark:text-yellow-400";
  const typeLabel = t(ISSUE_TYPE_KEY[issue.issue_type] ?? "issue-unknown");

  return (
    <Card className="p-4 flex flex-row gap-4 items-center">
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
        </div>
        <p className="text-sm text-muted-foreground">{issue.description}</p>
        {issue.member_ids.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {issue.member_ids.map((id) => (
              <button
                key={id}
                className="text-xs px-2 py-0.5 rounded-full bg-muted hover:bg-muted/70 transition-colors font-mono cursor-pointer"
                onClick={() => navigateTo("tree-view")}
                title={t("view-member")}
              >
                {memberLabel(id, members)}
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export const QualityReportView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "quality-report-view",
  });
  const { report, isLoading, refreshReport } = useQualityReportStore();

  useEffect(() => {
    if (!report) {
      refreshReport();
    }
  }, [report, refreshReport]);

  const issues = report?.issues ?? [];
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  const sortedIssues = [...issues].sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });

  return (
    <ViewLayout title={t("title")}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {issues.length > 0 && (
            <>
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
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => refreshReport()}
          disabled={isLoading}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </Button>
      </div>

      {isLoading && !report ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
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
          {sortedIssues.map((issue, idx) => (
            <IssueCard key={`${issue.issue_type}-${idx}`} issue={issue} />
          ))}
        </div>
      )}
    </ViewLayout>
  );
};
