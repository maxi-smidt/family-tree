import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ClipboardCheck, FolderTree } from "lucide-react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/utils/dateUtils";
import {
  useMigrationReviewStore,
  usePendingMigrationReviewCount,
} from "@/hooks/useMigrationReviewStore";
import { MigrationReportDB } from "@/types/migration";
import { GrantWidenDialog } from "@/components/view/migration-review-view/GrantWidenDialog";
import { MigrationConflictCard } from "@/components/view/migration-review-view/MigrationConflictCard";

function WorkspaceMappingRow({
  mapping,
}: {
  mapping: Record<string, unknown>;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view",
  });
  const sourceName = String(
    mapping.source_workspace_name ?? mapping.source_workspace_id,
  );
  const isSurvivor = Boolean(mapping.is_survivor);
  const sectionId = mapping.target_section_id as string | null | undefined;

  return (
    <li className="text-sm flex items-center justify-between gap-2 py-1">
      <span className="truncate">{sourceName}</span>
      <span className="text-muted-foreground text-xs shrink-0">
        {isSurvivor
          ? t("report.mapping-became-workspace")
          : t("report.mapping-became-section", { sectionId })}
      </span>
    </li>
  );
}

function GrantChangeRow({
  reportId,
  change,
}: {
  reportId: string;
  change: Record<string, unknown>;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const userId = change.user_id as string | undefined;
  const sectionId = change.section_id as string | undefined;
  const role = change.role as string | undefined;

  if (!userId || !sectionId) {
    // A public-link change: informational only, nothing to widen.
    return (
      <li className="text-sm text-muted-foreground py-1">
        {t("report.public-link-scoped", { sectionId: change.section_id })}
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <span className="text-sm truncate">
        {t("report.grant-scoped", { role, sectionId })}
      </span>
      <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
        {t("report.widen-action")}
      </Button>
      <GrantWidenDialog
        reportId={reportId}
        sectionId={sectionId}
        userId={userId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </li>
  );
}

function MigrationReportCard({ report }: { report: MigrationReportDB }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view",
  });
  const acknowledgeReport = useMigrationReviewStore((s) => s.acknowledgeReport);
  const [acking, setAcking] = useState(false);

  const handleAcknowledge = async () => {
    setAcking(true);
    try {
      await acknowledgeReport(report.id);
    } catch {
      toast.error(t("report.acknowledge-error"));
    } finally {
      setAcking(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          {t("report.created-on", { date: formatDate(report.created_at) })}
        </CardTitle>
        <Badge
          variant={report.status === "acknowledged" ? "secondary" : "default"}
        >
          {t(`report.status-${report.status}`)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {report.workspace_mappings.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-1">
              {t("report.workspaces-title")}
            </h3>
            <ul className="divide-y">
              {report.workspace_mappings.map((m, i) => (
                <WorkspaceMappingRow key={i} mapping={m} />
              ))}
            </ul>
          </div>
        )}

        {report.grant_changes.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-1">
              {t("report.access-title")}
            </h3>
            <ul className="divide-y">
              {report.grant_changes.map((c, i) => (
                <GrantChangeRow key={i} reportId={report.id} change={c} />
              ))}
            </ul>
          </div>
        )}

        {report.converted_virtual_views.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-1">
              {t("report.converted-views-title")}
            </h3>
            <ul className="list-disc list-inside text-sm space-y-0.5">
              {report.converted_virtual_views.map((v, i) => (
                <li key={i}>{String(v.name ?? v.virtual_view_id)}</li>
              ))}
            </ul>
          </div>
        )}

        {report.dropped_virtual_views.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-1">
              {t("report.dropped-views-title")}
            </h3>
            <ul className="list-disc list-inside text-sm space-y-0.5 text-muted-foreground">
              {report.dropped_virtual_views.map((v, i) => (
                <li key={i}>{String(v.name ?? v.virtual_view_id)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={report.status === "acknowledged" || acking}
            onClick={() => void handleAcknowledge()}
          >
            {report.status === "acknowledged"
              ? t("report.acknowledged")
              : t("report.acknowledge")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export const MigrationReviewView = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view",
  });
  const reports = useMigrationReviewStore((s) => s.reports);
  const conflicts = useMigrationReviewStore((s) => s.conflicts);
  const loading = useMigrationReviewStore((s) => s.loading);
  const loaded = useMigrationReviewStore((s) => s.loaded);
  const load = useMigrationReviewStore((s) => s.load);
  const pendingCount = usePendingMigrationReviewCount();

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingConflicts = conflicts.filter((c) => c.status === "pending");
  const decidedConflicts = conflicts.filter((c) => c.status !== "pending");
  const isEmpty = loaded && reports.length === 0 && conflicts.length === 0;

  return (
    <ViewLayout title={t("title")}>
      {!loaded && loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : isEmpty ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck className="size-6" />
            </EmptyMedia>
            <EmptyTitle>{t("empty-title")}</EmptyTitle>
            <EmptyDescription>{t("empty-description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs defaultValue="report" className="flex-1 min-h-0 flex flex-col">
          <TabsList variant="line" className="flex-none">
            <TabsTrigger value="report">
              <FolderTree className="size-4" />
              {t("tab-report")}
            </TabsTrigger>
            <TabsTrigger value="checklist">
              <ClipboardCheck className="size-4" />
              {t("tab-checklist")}
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-1">
                  {pendingConflicts.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="report"
            className="flex-1 min-h-0 overflow-auto space-y-4 pt-3"
          >
            {reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("no-reports")}</p>
            ) : (
              reports.map((r) => <MigrationReportCard key={r.id} report={r} />)
            )}
          </TabsContent>
          <TabsContent
            value="checklist"
            className="flex-1 min-h-0 overflow-auto space-y-3 pt-3"
          >
            {pendingConflicts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("checklist.no-pending")}
              </p>
            ) : (
              pendingConflicts.map((c) => (
                <MigrationConflictCard key={c.id} conflict={c} />
              ))
            )}
            {decidedConflicts.length > 0 && (
              <div className="pt-4">
                <h3 className="text-sm font-medium mb-2 text-muted-foreground">
                  {t("checklist.history-title")}
                </h3>
                <div className="space-y-2">
                  {decidedConflicts.map((c) => (
                    <MigrationConflictCard key={c.id} conflict={c} />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </ViewLayout>
  );
};
