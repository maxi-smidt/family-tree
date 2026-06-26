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
import type { StatisticsReport } from "@/types/statistics";
import type { CustomWidget } from "./customWidgets";
import { DATA_SERIES_MAP } from "./customWidgets";
import { ChartTooltipContent } from "./ChartTooltipContent";

interface Props {
  widget: CustomWidget;
  report: StatisticsReport;
}

export function CustomWidgetRenderer({ widget, report }: Props) {
  // Build a combined data array merging all selected series on the same category axis.
  const seriesDefs = widget.series.map((id) => DATA_SERIES_MAP[id]);
  if (seriesDefs.length === 0) return null;

  // For multi-series: merge by category key.
  const categoryMap = new Map<string, Record<string, number>>();
  for (const def of seriesDefs) {
    for (const point of def.extract(report)) {
      const row = categoryMap.get(point.category) ?? {};
      row[def.id] = point.value;
      categoryMap.set(point.category, row);
    }
  }
  const data = Array.from(categoryMap.entries()).map(([category, values]) => ({
    category,
    ...values,
  }));

  if (data.length === 0) return null;

  // For pie charts only the first series is used.
  const firstSeriesId = widget.series[0];

  const chartHeight = 220;

  const renderChart = () => {
    switch (widget.chartType) {
      case "bar":
        return (
          <BarChart data={data} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              label={
                widget.xLabel
                  ? { value: widget.xLabel, position: "insideBottom", offset: -4, fontSize: 11 }
                  : undefined
              }
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={28}
              label={
                widget.yLabel
                  ? { value: widget.yLabel, angle: -90, position: "insideLeft", fontSize: 11 }
                  : undefined
              }
            />
            <Tooltip
              content={({ active, label, payload }) => (
                <ChartTooltipContent active={active} label={label} payload={payload} />
              )}
            />
            {seriesDefs.map((def, i) => (
              <Bar
                key={def.id}
                dataKey={def.id}
                fill={i === 0 ? widget.color : adjustColor(widget.color, i)}
                radius={[3, 3, 0, 0]}
                name={def.id}
              />
            ))}
            {seriesDefs.length > 1 && (
              <Legend iconType="square" iconSize={8} formatter={(v) => <span className="text-xs text-foreground">{v}</span>} />
            )}
          </BarChart>
        );

      case "pie":
        return (
          <PieChart>
            <Pie
              data={data}
              dataKey={firstSeriesId}
              nameKey="category"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
            >
              {data.map((entry, i) => (
                <Cell key={entry.category} fill={i === 0 ? widget.color : adjustColor(widget.color, i)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, label, payload }) => (
                <ChartTooltipContent active={active} hideLabel label={label} payload={payload} />
              )}
            />
            <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-foreground">{v}</span>} />
          </PieChart>
        );

      case "line":
        return (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              label={
                widget.xLabel
                  ? { value: widget.xLabel, position: "insideBottom", offset: -4, fontSize: 11 }
                  : undefined
              }
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={28}
              label={
                widget.yLabel
                  ? { value: widget.yLabel, angle: -90, position: "insideLeft", fontSize: 11 }
                  : undefined
              }
            />
            <Tooltip
              content={({ active, label, payload }) => (
                <ChartTooltipContent active={active} label={label} payload={payload} />
              )}
            />
            {seriesDefs.map((def, i) => (
              <Line
                key={def.id}
                type="monotone"
                dataKey={def.id}
                stroke={i === 0 ? widget.color : adjustColor(widget.color, i)}
                dot={false}
                name={def.id}
              />
            ))}
            {seriesDefs.length > 1 && (
              <Legend iconType="line" iconSize={8} formatter={(v) => <span className="text-xs text-foreground">{v}</span>} />
            )}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              label={
                widget.xLabel
                  ? { value: widget.xLabel, position: "insideBottom", offset: -4, fontSize: 11 }
                  : undefined
              }
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={28}
              label={
                widget.yLabel
                  ? { value: widget.yLabel, angle: -90, position: "insideLeft", fontSize: 11 }
                  : undefined
              }
            />
            <Tooltip
              content={({ active, label, payload }) => (
                <ChartTooltipContent active={active} label={label} payload={payload} />
              )}
            />
            {seriesDefs.map((def, i) => (
              <Area
                key={def.id}
                type="monotone"
                dataKey={def.id}
                stroke={i === 0 ? widget.color : adjustColor(widget.color, i)}
                fill={`${i === 0 ? widget.color : adjustColor(widget.color, i)}33`}
                name={def.id}
              />
            ))}
            {seriesDefs.length > 1 && (
              <Legend iconType="square" iconSize={8} formatter={(v) => <span className="text-xs text-foreground">{v}</span>} />
            )}
          </AreaChart>
        );
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{widget.title}</h2>
      <ResponsiveContainer width="100%" height={chartHeight}>
        {renderChart()}
      </ResponsiveContainer>
    </Card>
  );
}

// Simple hue-shift so multiple series in one chart have distinct colors.
function adjustColor(hex: string, index: number): string {
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const shift = (index * 60) % 256;
  const nr = (r + shift) % 256;
  const ng = (g + shift * 2) % 256;
  const nb = (b + shift) % 256;
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}
