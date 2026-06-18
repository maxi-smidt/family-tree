import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Users, Clock, CalendarDays, Skull } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import { useStatisticsSettings, normalizeOrder } from "@/hooks/useStatisticsSettings";
import { WIDGET_MAP } from "./widgets";
import { CustomizePopover } from "./CustomizePopover";

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
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    </div>
  );
}

function EmptyState({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
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
  const { order, hidden } = useStatisticsSettings();

  useEffect(() => {
    if (!report) {
      refreshStatistics();
    }
  }, [report, refreshStatistics]);

  const visibleIds = normalizeOrder(order).filter((id) => !hidden.includes(id));

  const actions = (
    <div className="flex items-center gap-2">
      <CustomizePopover />
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => refreshStatistics()}
        disabled={isLoading}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        {t("refresh")}
      </Button>
    </div>
  );

  return (
    <ViewLayout title={t("title")} action={actions}>
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

          {/* Customizable charts grid */}
          {visibleIds.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("all-hidden")}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {visibleIds.map((id) => {
                const Widget = WIDGET_MAP[id].Component;
                return <Widget key={id} report={report} t={t} />;
              })}
            </div>
          )}
        </div>
      )}
    </ViewLayout>
  );
};
