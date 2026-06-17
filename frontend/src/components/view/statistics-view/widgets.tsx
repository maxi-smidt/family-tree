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
import { Card } from "@/components/ui/card";
import type { StatisticsReport } from "@/types/statistics";
import { ChartTooltipContent } from "./ChartTooltipContent";

const GENDER_COLORS = {
  male: "var(--color-chart-gender-male)",
  female: "var(--color-chart-gender-female)",
  other: "var(--color-chart-gender-other)",
  unknown: "var(--color-chart-gender-unknown)",
};

const BIRTH_COLOR = "var(--color-chart-birth)";
const DEATH_COLOR = "var(--color-chart-death)";
const NAME_COLOR = "var(--color-chart-birth)";

export interface StatisticsWidgetProps {
  report: StatisticsReport;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export type StatisticsWidgetId =
  | "gender"
  | "timeline"
  | "lifespan"
  | "first-names"
  | "last-names";

export interface StatisticsWidgetDefinition {
  id: StatisticsWidgetId;
  titleKey: string;
  Component: React.ComponentType<StatisticsWidgetProps>;
}

function GenderChart({ report, t }: StatisticsWidgetProps) {
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
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                hideLabel
                label={label}
                payload={payload}
              />
            )}
          />
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

function TimelineChart({ report, t }: StatisticsWidgetProps) {
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
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={(name) =>
                  name === "births"
                    ? t("timeline-births")
                    : t("timeline-deaths")
                }
                payload={payload}
              />
            )}
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

function LifespanChart({ report, t }: StatisticsWidgetProps) {
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
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={() => t("lifespan-people")}
                payload={payload}
              />
            )}
          />
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

function FirstNamesChart({ report, t }: StatisticsWidgetProps) {
  const data = report.top_first_names.slice(0, 10);
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("first-names-title")}</h2>
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
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={() => t("names-count")}
                payload={payload}
              />
            )}
          />
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

function LastNamesChart({ report, t }: StatisticsWidgetProps) {
  const data = report.top_last_names.slice(0, 10);
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("last-names-title")}</h2>
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
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={() => t("names-count")}
                payload={payload}
              />
            )}
          />
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

export const STATISTICS_WIDGETS: StatisticsWidgetDefinition[] = [
  { id: "gender", titleKey: "gender-title", Component: GenderChart },
  { id: "timeline", titleKey: "timeline-title", Component: TimelineChart },
  { id: "lifespan", titleKey: "lifespan-title", Component: LifespanChart },
  {
    id: "first-names",
    titleKey: "first-names-title",
    Component: FirstNamesChart,
  },
  {
    id: "last-names",
    titleKey: "last-names-title",
    Component: LastNamesChart,
  },
];

export const ALL_WIDGET_IDS: StatisticsWidgetId[] = STATISTICS_WIDGETS.map(
  (w) => w.id,
);

export const WIDGET_MAP: Record<StatisticsWidgetId, StatisticsWidgetDefinition> =
  Object.fromEntries(STATISTICS_WIDGETS.map((w) => [w.id, w])) as Record<
    StatisticsWidgetId,
    StatisticsWidgetDefinition
  >;
