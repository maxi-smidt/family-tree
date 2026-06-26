import type { StatisticsReport } from "@/types/statistics";

export type CustomChartType = "bar" | "pie" | "line" | "area";

export type DataSeriesId =
  | "births-by-decade"
  | "deaths-by-decade"
  | "lifespan-distribution"
  | "top-first-names"
  | "top-last-names"
  | "gender-distribution";

// Groups that are dimensionally compatible — only series sharing the same domain
// may be combined in a single multi-series chart.
export type SeriesDomain = "decade" | "lifespan" | "names" | "gender";

export interface DataPoint {
  category: string;
  value: number;
}

export interface DataSeriesDefinition {
  id: DataSeriesId;
  labelKey: string;
  domain: SeriesDomain;
  extract: (r: StatisticsReport) => DataPoint[];
}

export const DATA_SERIES_REGISTRY: DataSeriesDefinition[] = [
  {
    id: "births-by-decade",
    labelKey: "series-births-by-decade",
    domain: "decade",
    extract: (r) =>
      r.birth_death_by_decade.map((d) => ({ category: d.decade, value: d.births })),
  },
  {
    id: "deaths-by-decade",
    labelKey: "series-deaths-by-decade",
    domain: "decade",
    extract: (r) =>
      r.birth_death_by_decade.map((d) => ({ category: d.decade, value: d.deaths })),
  },
  {
    id: "lifespan-distribution",
    labelKey: "series-lifespan-distribution",
    domain: "lifespan",
    extract: (r) =>
      r.lifespan_distribution.map((d) => ({ category: d.range, value: d.count })),
  },
  {
    id: "top-first-names",
    labelKey: "series-top-first-names",
    domain: "names",
    extract: (r) =>
      r.top_first_names.slice(0, 10).map((d) => ({ category: d.name, value: d.count })),
  },
  {
    id: "top-last-names",
    labelKey: "series-top-last-names",
    domain: "names",
    extract: (r) =>
      r.top_last_names.slice(0, 10).map((d) => ({ category: d.name, value: d.count })),
  },
  {
    id: "gender-distribution",
    labelKey: "series-gender-distribution",
    domain: "gender",
    extract: (r) => {
      const g = r.gender_distribution;
      return [
        { category: "male", value: g.male },
        { category: "female", value: g.female },
        { category: "other", value: g.other },
        { category: "unknown", value: g.unknown },
      ].filter((d) => d.value > 0);
    },
  },
];

export const DATA_SERIES_MAP: Record<DataSeriesId, DataSeriesDefinition> =
  Object.fromEntries(DATA_SERIES_REGISTRY.map((s) => [s.id, s])) as Record<
    DataSeriesId,
    DataSeriesDefinition
  >;

export interface CustomWidget {
  id: string;
  kind: "custom";
  chartType: CustomChartType;
  series: DataSeriesId[];
  title: string;
  xLabel?: string;
  yLabel?: string;
  color: string;
}

export type CustomWidgetConfig = Omit<CustomWidget, "id" | "kind">;

export const DEFAULT_WIDGET_COLOR = "#6366f1";
