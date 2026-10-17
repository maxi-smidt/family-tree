import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, ClipboardCheck } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Meter } from "@/components/shared/Meter";
import { cn } from "@/lib/utils";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatDate } from "@/utils/dateUtils";
import {
  useIsGrantWidened,
  useMigrationReviewStore,
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
    <li className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
      <span className="truncate font-semibold">{sourceName}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
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
  const { t: tShare } = useTranslation(undefined, {
    keyPrefix: "dialog.share-tree",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const userId = change.user_id as string | undefined;
  const sectionId = change.section_id as string | undefined;
  const role = change.role as string | undefined;
  const widened = useIsGrantWidened(reportId, sectionId ?? "", userId ?? "");

  if (!userId || !sectionId) {
    // A public-link change: informational only, nothing to widen.
    return (
      <li className="px-5 py-3 text-sm text-muted-foreground">
        {t("report.public-link-scoped", { sectionId: change.section_id })}
      </li>
    );
  }

  const roleLabel =
    role === "editor" || role === "viewer"
      ? tShare(`role-${role}`)
      : (role ?? "");

  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <span className="truncate text-sm">
        {t("report.grant-scoped", { role: roleLabel, sectionId })}
      </span>
      {widened ? (
        <Badge variant="success">{t("report.widened")}</Badge>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          {t("report.widen-action")}
        </Button>
      )}
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

function AcknowledgeRow({ report }: { report: MigrationReportDB }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "migration-review-view",
  });
  const acknowledgeReport = useMigrationReviewStore((s) => s.acknowledgeReport);
  const [acking, setAcking] = useState(false);
  const done = report.status === "acknowledged";

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
    <li className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {t("report.created-on", { date: formatDate(report.created_at) })}
        </p>
        <Badge variant={done ? "success" : "warning"} className="mt-1">
          {t(`report.status-${report.status}`)}
        </Badge>
      </div>
      <Button
        size="sm"
        disabled={done || acking}
        onClick={() => void handleAcknowledge()}
      >
        {done ? t("report.acknowledged") : t("report.acknowledge")}
      </Button>
    </li>
  );
}

type StepId = "workspaces" | "views" | "access" | "differences" | "final";

/** A white list card used by every step's content. */
function StepList({ children }: { children: React.ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">{children}</ul>
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
  const [step, setStep] = useState<StepId>("workspaces");
  const [visited, setVisited] = useState<Set<StepId>>(
    () => new Set(["workspaces"]),
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingConflicts = conflicts.filter((c) => c.status === "pending");
  const decidedConflicts = conflicts.filter((c) => c.status !== "pending");
  const isEmpty = loaded && reports.length === 0 && conflicts.length === 0;

  // One review across every report the account has (usually just one).
  const mappings = reports.flatMap((r) => r.workspace_mappings);
  const grants = reports.flatMap((r) =>
    r.grant_changes.map((change) => ({ reportId: r.id, change })),
  );
  const converted = reports.flatMap((r) => r.converted_virtual_views);
  const dropped = reports.flatMap((r) => r.dropped_virtual_views);
  const allAcknowledged =
    reports.length > 0 && reports.every((r) => r.status === "acknowledged");

  const steps: {
    id: StepId;
    title: string;
    note: string;
    done: boolean;
    attention?: boolean;
  }[] = [
    {
      id: "workspaces",
      title: t("steps.workspaces"),
      note: t("steps.workspaces-note", { count: mappings.length }),
      done: visited.has("workspaces"),
    },
    {
      id: "views",
      title: t("steps.views"),
      note: t("steps.views-note", { count: converted.length }),
      done: visited.has("views"),
    },
    {
      id: "access",
      title: t("steps.access"),
      note: t("steps.access-note", { count: grants.length }),
      done: visited.has("access"),
    },
    {
      id: "differences",
      title: t("tab-checklist"),
      note:
        pendingConflicts.length > 0
          ? t("steps.differences-left", { count: pendingConflicts.length })
          : t("steps.differences-none"),
      done: pendingConflicts.length === 0,
      attention: pendingConflicts.length > 0,
    },
    {
      id: "final",
      title: t("steps.final"),
      note: t("steps.final-note"),
      done: allAcknowledged,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const selectStep = (id: StepId) => {
    setStep(id);
    setVisited((prev) => new Set(prev).add(id));
  };

  return (
    <ViewLayout title={t("title")} subtitle={t("subtitle")}>
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
        <TabsPrimitive.Root
          value={step}
          onValueChange={(v) => selectStep(v as StepId)}
          orientation="vertical"
          className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row"
        >
          <div className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
            <Card className="gap-2 px-5 py-4">
              <Meter
                label={
                  <span className="font-semibold">
                    {t("steps.progress", {
                      done: doneCount,
                      total: steps.length,
                    })}
                  </span>
                }
                valueLabel={`${Math.round((doneCount / steps.length) * 100)}%`}
                value={doneCount / steps.length}
              />
            </Card>
            <TabsPrimitive.List
              aria-label={t("steps.label")}
              className="flex flex-col gap-1"
            >
              {steps.map((s, index) => (
                <TabsPrimitive.Trigger
                  key={s.id}
                  value={s.id}
                  className="group flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:shadow-xs"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums",
                      s.done
                        ? "border-primary bg-primary text-primary-foreground"
                        : s.attention
                          ? "border-warning text-warning"
                          : "text-muted-foreground",
                    )}
                  >
                    {s.done ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {s.title}
                    </span>
                    <span
                      className={cn(
                        "block text-xs",
                        s.attention ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {s.note}
                    </span>
                  </span>
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-auto pb-4">
            <TabsPrimitive.Content value="workspaces" className="space-y-4">
              <StepHeading
                title={t("steps.workspaces")}
                body={t("steps.workspaces-body")}
              />
              {mappings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("no-reports")}
                </p>
              ) : (
                <StepList>
                  {mappings.map((m, i) => (
                    <WorkspaceMappingRow key={i} mapping={m} />
                  ))}
                </StepList>
              )}
            </TabsPrimitive.Content>

            <TabsPrimitive.Content value="views" className="space-y-4">
              <StepHeading
                title={t("steps.views")}
                body={t("steps.views-body")}
              />
              {converted.length === 0 && dropped.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("steps.views-none")}
                </p>
              ) : (
                <>
                  {converted.length > 0 && (
                    <StepList>
                      {converted.map((v, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                        >
                          <span className="truncate font-semibold">
                            {String(v.name ?? v.virtual_view_id)}
                          </span>
                          <Badge variant="success">
                            {t("report.converted-views-title")}
                          </Badge>
                        </li>
                      ))}
                    </StepList>
                  )}
                  {dropped.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">
                        {t("report.dropped-views-title")}
                      </h3>
                      <StepList>
                        {dropped.map((v, i) => (
                          <li
                            key={i}
                            className="px-5 py-3 text-sm text-muted-foreground"
                          >
                            {String(v.name ?? v.virtual_view_id)}
                          </li>
                        ))}
                      </StepList>
                    </div>
                  )}
                </>
              )}
            </TabsPrimitive.Content>

            <TabsPrimitive.Content value="access" className="space-y-4">
              <StepHeading
                title={t("steps.access")}
                body={t("steps.access-body")}
              />
              {grants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("steps.access-none")}
                </p>
              ) : (
                <StepList>
                  {grants.map(({ reportId, change }, i) => (
                    <GrantChangeRow
                      key={i}
                      reportId={reportId}
                      change={change}
                    />
                  ))}
                </StepList>
              )}
            </TabsPrimitive.Content>

            <TabsPrimitive.Content value="differences" className="space-y-3">
              <StepHeading
                title={t("tab-checklist")}
                body={t("steps.differences-body")}
              />
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
                <div className="space-y-2 pt-4">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {t("checklist.history-title")}
                  </h3>
                  {decidedConflicts.map((c) => (
                    <MigrationConflictCard key={c.id} conflict={c} />
                  ))}
                </div>
              )}
            </TabsPrimitive.Content>

            <TabsPrimitive.Content value="final" className="space-y-4">
              <StepHeading
                title={t("steps.final")}
                body={t("steps.final-body")}
              />
              {reports.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("no-reports")}
                </p>
              ) : (
                <StepList>
                  {reports.map((r) => (
                    <AcknowledgeRow key={r.id} report={r} />
                  ))}
                </StepList>
              )}
            </TabsPrimitive.Content>
          </div>
        </TabsPrimitive.Root>
      )}
    </ViewLayout>
  );
};

function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
