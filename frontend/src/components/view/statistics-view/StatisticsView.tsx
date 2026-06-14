import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Users, Clock, CalendarDays, Skull } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import type { StatisticsReport } from "@/types/statistics";

const GENDER_COLORS = {
  male: "var(--color-chart-gender-male)",
  female: "var(--color-chart-gender-female)",
  other: "var(--color-chart-gender-other)",
  unknown: "var(--color-chart-gender-unknown)",
};

const BIRTH_COLOR = "var(--color-chart-birth)";
const DEATH_COLOR = "var(--color-chart-death)";
const NAME_COLOR = "var(--color-chart-birth)";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
      </div>
    </Card>
  );
}

function GenderChart({
  report,
  t,
}: {
  report: StatisticsReport;
  t: (k: string) => string;
}) {
  const { gender_distribution: g } = report;
  const data = [
    { name: t("gender-male"), value: g.male, color: GENDER_COLORS.male },
    { name: t("gender-female"), value: g.female, color: GENDER_COLORS.female },
    { name: t("gender-other"), value: g.other, color: GENDER_COLORS.other },
    {
      name: t("gender-unknown"),
      value: g.unknown,
      color: GENDER_COLORS.unknown,
    },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("gender-title")}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span className="text-xs text-foreground">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

function TimelineChart({
  report,
  t,
}: {
  report: StatisticsReport;
  t: (k: string) => string;
}) {
  const data = report.birth_death_by_decade;
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("timeline-title")}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="decade"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            labelFormatter={(l) => `${l}`}
            formatter={(value, name) => [
              value,
              name === "births" ? t("timeline-births") : t("timeline-deaths"),
            ]}
          />
          <Bar
            dataKey="births"
            fill={BIRTH_COLOR}
            radius={[3, 3, 0, 0]}
            name="births"
          />
          <Bar
            dataKey="deaths"
            fill={DEATH_COLOR}
            radius={[3, 3, 0, 0]}
            name="deaths"
          />
          <Legend
            iconType="square"
            iconSize={8}
            formatter={(value) => (
              <span className="text-xs text-foreground">
                {value === "births"
                  ? t("timeline-births")
                  : t("timeline-deaths")}
              </span>
            )}
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function LifespanChart({
  report,
  t,
}: {
  report: StatisticsReport;
  t: (k: string) => string;
}) {
  const data = report.lifespan_distribution;
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("lifespan-title")}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="range"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip formatter={(value) => [value, t("lifespan-people")]} />
          <Bar
            dataKey="count"
            fill={BIRTH_COLOR}
            radius={[3, 3, 0, 0]}
            name="count"
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function NamesChart({
  report,
  t,
}: {
  report: StatisticsReport;
  t: (k: string) => string;
}) {
  const data = report.top_first_names.slice(0, 10);
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("names-title")}</h2>
      <ResponsiveContainer
        width="100%"
        height={Math.max(180, data.length * 28 + 40)}
      >
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            horizontal={false}
            className="stroke-border"
          />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip formatter={(value) => [value, t("names-count")]} />
          <Bar
            dataKey="count"
            fill={NAME_COLOR}
            radius={[0, 3, 3, 0]}
            name="count"
          />
        </BarChart>
      </ResponsiveContainer>
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

  useEffect(() => {
    if (!report) {
      refreshStatistics();
    }
  }, [report, refreshStatistics]);

  const refreshButton = (
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
  );

  return (
    <ViewLayout title={t("title")} action={refreshButton}>
      {isLoading && !report ? (
        <LoadingState t={t} />
      ) : !report || report.total_members === 0 ? (
        <EmptyState t={t} />
      ) : (
        <div className="space-y-4 pb-4">
          {/* Overview cards */}
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

          {/* Charts grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <GenderChart report={report} t={t} />
            <TimelineChart report={report} t={t} />
            <LifespanChart report={report} t={t} />
            <NamesChart report={report} t={t} />
          </div>
        </div>
      )}
    </ViewLayout>
  );
};
