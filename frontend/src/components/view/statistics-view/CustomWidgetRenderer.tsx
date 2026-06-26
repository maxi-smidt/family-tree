import { useMemo } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import type { Member } from "@/types/member";
import {
  aggregate,
  DIMENSION_MAP,
  MEASURE_MAP,
  type CustomWidget,
  type TFunc,
} from "./customWidgets";
import { ChartTooltipContent } from "./ChartTooltipContent";

interface Props {
  widget: CustomWidget;
  members: Member[];
  t: TFunc;
}

const CHART_HEIGHT = 240;

export function CustomWidgetRenderer({ widget, members, t }: Props) {
  const { data, series } = useMemo(
    () => aggregate(members, widget, t),
    [members, widget, t],
  );

  if (data.length === 0 || series.length === 0) return null;

  const multi = series.length > 1;
  // Stacking applies only to multi-series bar/area charts; default on.
  const stack = multi && (widget.stacked ?? true);
  const seriesLabel = (key: string) =>
    series.find((s) => s.key === key)?.label ?? key;

  // Axis labels default to the dimension / measure names when not overridden.
  const xLabel = widget.xLabel?.trim() || t(DIMENSION_MAP[widget.dimensionId].labelKey);
  const yLabel = widget.yLabel?.trim() || t(MEASURE_MAP[widget.measureId].labelKey);

  const xAxisLabel = xLabel
    ? { value: xLabel, position: "insideBottom" as const, offset: -2, fontSize: 11 }
    : undefined;
  const yAxisLabel = yLabel
    ? { value: yLabel, angle: -90, position: "insideLeft" as const, fontSize: 11 }
    : undefined;

  const tooltip = (
    <Tooltip
      content={({ active, label, payload }) => (
        <ChartTooltipContent
          active={active}
          label={label}
          payload={payload}
          nameFormatter={(name) => seriesLabel(String(name ?? ""))}
        />
      )}
    />
  );

  const legend = multi ? (
    <Legend
      iconType="square"
      iconSize={8}
      formatter={(value) => (
        <span className="text-xs text-foreground">{seriesLabel(value)}</span>
      )}
    />
  ) : null;

  const renderChart = () => {
    switch (widget.chartType) {
      case "pie": {
        const key = series[0].key;
        return (
          <PieChart>
            <Pie
              data={data}
              dataKey={key}
              nameKey="category"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
            >
              {data.map((entry, i) => (
                <Cell
                  key={String(entry.category)}
                  fill={seriesColor(widget.color, i)}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, label, payload }) => (
                <ChartTooltipContent active={active} hideLabel label={label} payload={payload} />
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
        );
      }

      case "line":
        return (
          <LineChart data={data} margin={{ bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} label={xAxisLabel} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} label={yAxisLabel} />
            {tooltip}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={seriesColor(widget.color, i)}
                dot={false}
              />
            ))}
            {legend}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data} margin={{ bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} label={xAxisLabel} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} label={yAxisLabel} />
            {tooltip}
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={seriesColor(widget.color, i)}
                fill={`${seriesColor(widget.color, i)}33`}
                stackId={stack ? "1" : undefined}
              />
            ))}
            {legend}
          </AreaChart>
        );

      case "bar":
      default:
        return (
          <BarChart data={data} barGap={2} margin={{ bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} label={xAxisLabel} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} label={yAxisLabel} />
            {tooltip}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.key}
                fill={seriesColor(widget.color, i)}
                radius={[3, 3, 0, 0]}
                stackId={stack ? "1" : undefined}
              />
            ))}
            {legend}
          </BarChart>
        );
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4 truncate" title={widget.title}>
        {widget.title}
      </h2>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        {renderChart()}
      </ResponsiveContainer>
    </Card>
  );
}

// Derives distinct colors for multiple series from the user's base color by
// rotating hue; the first series always uses the chosen color exactly.
function seriesColor(base: string, index: number): string {
  if (index === 0) return base;
  const hsl = hexToHsl(base);
  if (!hsl) return base;
  const hue = (hsl.h + index * 47) % 360;
  return `hsl(${hue}, ${hsl.s}%, ${hsl.l}%)`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
