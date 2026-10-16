import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Users, Clock, CalendarDays, Skull } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { STATISTICS_WIDGETS } from "./widgets";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <Card className="items-center gap-3 p-4 text-center">
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="w-full min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
      </div>
    </Card>
  );
}

function LoadingState({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
      <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    </div>
  );
}

function EmptyState({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Users className="w-7 h-7 text-muted-foreground opacity-40" />
      </div>
      <div>
        <p className="font-medium">{t("empty-title")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t("empty-description")}
        </p>
      </div>
    </div>
  );
}

export const StatisticsView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "statistics-view" });
  const { report, isLoading, refreshStatistics } = useStatisticsStore();
  const members = useMemberStore((s) => s.members);
  const events = useEventStore((s) => s.events);
  const eventsInitialized = useEventStore((s) => s.initialized);
  const refreshEvents = useEventStore((s) => s.refreshEvents);
  const stories = useStoryStore((s) => s.stories);
  const storiesInitialized = useStoryStore((s) => s.initialized);
  const refreshStories = useStoryStore((s) => s.refreshStories);
  const selectedTreeId = useWorkspaceStore((s) => s.selectedTree?.id);
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);

  useDeferredStoreLoad(eventsInitialized, refreshEvents);
  useDeferredStoreLoad(storiesInitialized, refreshStories);

  useEffect(() => {
    if (!report) {
      refreshStatistics();
    }
  }, [report, refreshStatistics]);

  const handleOpenMember = useCallback(
    (memberId: string) => {
      if (!selectedTreeId) return;
      setOpenSheet(selectedTreeId, {
        memberId,
        tab: "identity",
        mode: "view",
      });
    },
    [selectedTreeId, setOpenSheet],
  );

  return (
    <ViewLayout title={t("title")}>
      {isLoading && !report ? (
        <LoadingState t={t} />
      ) : !report || report.total_members === 0 ? (
        <EmptyState t={t} />
      ) : (
        <div className="space-y-4 pb-4">
          {/* Overview cards — always shown */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={<Users className="w-5 h-5 text-muted-foreground" />}
              label={t("stat-total-members")}
              value={report.total_members}
            />
            <StatCard
              icon={<CalendarDays className="w-5 h-5 text-muted-foreground" />}
              label={t("stat-with-birth")}
              value={`${report.members_with_birth_date} / ${report.total_members}`}
            />
            <StatCard
              icon={<Skull className="w-5 h-5 text-muted-foreground" />}
              label={t("stat-with-death")}
              value={`${report.members_with_death_date} / ${report.total_members}`}
            />
            <StatCard
              icon={<Clock className="w-5 h-5 text-muted-foreground" />}
              label={t("stat-avg-lifespan")}
              value={
                report.average_lifespan !== null
                  ? t("stat-avg-lifespan-value", {
                      years: report.average_lifespan,
                    })
                  : "—"
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {STATISTICS_WIDGETS.map(({ id, Component }) => (
              <Component
                key={id}
                report={report}
                t={t}
                members={members}
                events={events}
                stories={stories}
                onOpenMember={handleOpenMember}
              />
            ))}
          </div>
        </div>
      )}
    </ViewLayout>
  );
};
