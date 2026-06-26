import type { Member } from "@/types/member";
import { getYear } from "@/utils/dateUtils";

/**
 * Custom statistics widgets are built as a small pivot: pick a chart type, an
 * X-axis **dimension** (how to group members), a Y-axis **measure** (what to
 * compute per group), and an optional **breakdown** dimension that splits each
 * group into multiple series.
 *
 * Everything is computed client-side from the raw {@link Member} records held
 * in `useMemberStore`, so any member field can be charted — not just the
 * pre-aggregated backend report. The registries below are the stable contract a
 * future widget marketplace would serialize against.
 */

export type CustomChartType = "bar" | "pie" | "line" | "area";

// ── Dimensions (X axis / breakdown) ──────────────────────────────────────────

export type DimensionId =
  | "gender"
  | "birth-decade"
  | "death-decade"
  | "birth-year"
  | "age-at-death"
  | "birthplace"
  | "hometown"
  | "first-name"
  | "last-name"
  | "deceased-status"
  | "academic-title";

type CategoryOrder = "natural" | "value-desc";

export interface DimensionDefinition {
  id: DimensionId;
  labelKey: string;
  /** Bucket a member into a category, or null to exclude it from this dimension. */
  getValue: (m: Member) => string | null;
  /** How categories are ordered along the axis. */
  order: CategoryOrder;
  /** Comparator used when order is "natural". */
  naturalSort?: (a: string, b: string) => number;
  /** Cap the number of categories (applied after ordering). */
  limit?: number;
  /** Turn a raw category key into a display label (defaults to identity). */
  formatCategory?: (category: string, t: TFunc) => string;
}

export type TFunc = (key: string, opts?: Record<string, unknown>) => string;

// ── Measures (Y axis) ────────────────────────────────────────────────────────

export type MeasureId = "count" | "avg-lifespan" | "avg-age";

export interface MeasureDefinition {
  id: MeasureId;
  labelKey: string;
  /** Reduce a group of members to a number, or null when not computable. */
  compute: (members: Member[]) => number | null;
}

// ── Helpers (mirror the backend conventions) ─────────────────────────────────

function memberBirthYear(m: Member): number | null {
  return getYear(m.date.birthSort) ?? getYear(m.date.birth);
}

function memberDeathYear(m: Member): number | null {
  return getYear(m.date.deathSort) ?? getYear(m.date.death);
}

function decadeLabel(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

const CURRENT_YEAR = new Date().getFullYear();

const AGE_BUCKETS: Array<[number, number, string]> = [
  [0, 9, "0–9"],
  [10, 19, "10–19"],
  [20, 29, "20–29"],
  [30, 39, "30–39"],
  [40, 49, "40–49"],
  [50, 59, "50–59"],
  [60, 69, "60–69"],
  [70, 79, "70–79"],
  [80, 89, "80–89"],
  [90, 99, "90–99"],
  [100, 9999, "100+"],
];

const AGE_BUCKET_INDEX: Record<string, number> = Object.fromEntries(
  AGE_BUCKETS.map(([, , label], i) => [label, i]),
);

function ageAtDeath(m: Member): number | null {
  const b = memberBirthYear(m);
  const d = memberDeathYear(m);
  if (b !== null && d !== null && d >= b) return d - b;
  return null;
}

function numericLeadCompare(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
  return na - nb;
}

// ── Dimension registry ───────────────────────────────────────────────────────

export const DIMENSION_REGISTRY: DimensionDefinition[] = [
  {
    id: "gender",
    labelKey: "dim-gender",
    getValue: (m) => {
      const g = (m.gender || "").toLowerCase();
      return g === "m" || g === "f" || g === "o" ? g : "unknown";
    },
    order: "natural",
    naturalSort: (a, b) => {
      const ord = ["m", "f", "o", "unknown"];
      return ord.indexOf(a) - ord.indexOf(b);
    },
    formatCategory: (c, t) =>
      ({
        m: t("gender-male"),
        f: t("gender-female"),
        o: t("gender-other"),
        unknown: t("gender-unknown"),
      })[c] ?? c,
  },
  {
    id: "birth-decade",
    labelKey: "dim-birth-decade",
    getValue: (m) => {
      const y = memberBirthYear(m);
      return y !== null ? decadeLabel(y) : null;
    },
    order: "natural",
    naturalSort: numericLeadCompare,
  },
  {
    id: "death-decade",
    labelKey: "dim-death-decade",
    getValue: (m) => {
      const y = memberDeathYear(m);
      return y !== null ? decadeLabel(y) : null;
    },
    order: "natural",
    naturalSort: numericLeadCompare,
  },
  {
    id: "birth-year",
    labelKey: "dim-birth-year",
    getValue: (m) => {
      const y = memberBirthYear(m);
      return y !== null ? String(y) : null;
    },
    order: "natural",
    naturalSort: numericLeadCompare,
  },
  {
    id: "age-at-death",
    labelKey: "dim-age-at-death",
    getValue: (m) => {
      const age = ageAtDeath(m);
      if (age === null) return null;
      for (const [lo, hi, label] of AGE_BUCKETS) {
        if (age >= lo && age <= hi) return label;
      }
      return null;
    },
    order: "natural",
    naturalSort: (a, b) => (AGE_BUCKET_INDEX[a] ?? 0) - (AGE_BUCKET_INDEX[b] ?? 0),
  },
  {
    id: "birthplace",
    labelKey: "dim-birthplace",
    getValue: (m) => (m.birthplace?.trim() ? m.birthplace.trim() : null),
    order: "value-desc",
    limit: 12,
  },
  {
    id: "hometown",
    labelKey: "dim-hometown",
    getValue: (m) => (m.hometown?.trim() ? m.hometown.trim() : null),
    order: "value-desc",
    limit: 12,
  },
  {
    id: "first-name",
    labelKey: "dim-first-name",
    getValue: (m) => (m.firstName?.trim() ? m.firstName.trim() : null),
    order: "value-desc",
    limit: 12,
  },
  {
    id: "last-name",
    labelKey: "dim-last-name",
    getValue: (m) => (m.lastName?.trim() ? m.lastName.trim() : null),
    order: "value-desc",
    limit: 12,
  },
  {
    id: "deceased-status",
    labelKey: "dim-deceased-status",
    getValue: (m) => (m.deceased || m.date.death ? "deceased" : "living"),
    order: "natural",
    naturalSort: (a, b) => (a === "living" ? -1 : 1) - (b === "living" ? -1 : 1),
    formatCategory: (c, t) =>
      c === "living" ? t("status-living") : t("status-deceased"),
  },
  {
    id: "academic-title",
    labelKey: "dim-academic-title",
    getValue: (m) => (m.academicTitle?.trim() ? "with" : "without"),
    order: "natural",
    naturalSort: (a, b) => (a === "with" ? -1 : 1) - (b === "with" ? -1 : 1),
    formatCategory: (c, t) =>
      c === "with" ? t("title-with") : t("title-without"),
  },
];

export const DIMENSION_MAP: Record<DimensionId, DimensionDefinition> =
  Object.fromEntries(DIMENSION_REGISTRY.map((d) => [d.id, d])) as Record<
    DimensionId,
    DimensionDefinition
  >;

// ── Measure registry ─────────────────────────────────────────────────────────

export const MEASURE_REGISTRY: MeasureDefinition[] = [
  {
    id: "count",
    labelKey: "measure-count",
    compute: (members) => members.length,
  },
  {
    id: "avg-lifespan",
    labelKey: "measure-avg-lifespan",
    compute: (members) => {
      const spans = members
        .map(ageAtDeath)
        .filter((v): v is number => v !== null);
      if (spans.length === 0) return null;
      return Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10;
    },
  },
  {
    id: "avg-age",
    labelKey: "measure-avg-age",
    compute: (members) => {
      const ages = members
        .map((m) => {
          const b = memberBirthYear(m);
          if (b === null) return null;
          const d = memberDeathYear(m);
          const end = d ?? (m.deceased ? null : CURRENT_YEAR);
          if (end === null || end < b) return null;
          return end - b;
        })
        .filter((v): v is number => v !== null);
      if (ages.length === 0) return null;
      return Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10;
    },
  },
];

export const MEASURE_MAP: Record<MeasureId, MeasureDefinition> =
  Object.fromEntries(MEASURE_REGISTRY.map((m) => [m.id, m])) as Record<
    MeasureId,
    MeasureDefinition
  >;

// ── Widget config ────────────────────────────────────────────────────────────

export interface CustomWidget {
  id: string;
  kind: "custom";
  chartType: CustomChartType;
  dimensionId: DimensionId;
  measureId: MeasureId;
  /** Optional second dimension that splits each X group into multiple series. */
  breakdownId?: DimensionId | null;
  title: string;
  xLabel?: string;
  yLabel?: string;
  color: string;
}

export type CustomWidgetConfig = Omit<CustomWidget, "id" | "kind">;

export const DEFAULT_WIDGET_COLOR = "#6366f1";

/** Limit on breakdown series so high-cardinality splits stay readable. */
const MAX_BREAKDOWN_SERIES = 6;

export interface ChartSeries {
  /** Series key used as the recharts dataKey. */
  key: string;
  /** Human-readable series label. */
  label: string;
}

export interface AggregationResult {
  /** One row per X category; series values keyed by ChartSeries.key. */
  data: Array<Record<string, string | number>>;
  series: ChartSeries[];
}

/**
 * Pivot the members into chart-ready rows. Without a breakdown there is a
 * single "value" series; with one, each breakdown category becomes a series.
 */
export function aggregate(
  members: Member[],
  config: Pick<CustomWidget, "dimensionId" | "measureId" | "breakdownId">,
  t: TFunc,
): AggregationResult {
  const dim = DIMENSION_MAP[config.dimensionId];
  const measure = MEASURE_MAP[config.measureId];
  if (!dim || !measure) return { data: [], series: [] };

  const breakdown =
    config.breakdownId && config.breakdownId !== config.dimensionId
      ? DIMENSION_MAP[config.breakdownId]
      : undefined;

  // group members by X category (and breakdown sub-category)
  const groups = new Map<string, Map<string, Member[]>>();
  for (const m of members) {
    const cat = dim.getValue(m);
    if (cat === null) continue;
    const sub = breakdown ? breakdown.getValue(m) : "__value__";
    if (sub === null) continue;
    let bySub = groups.get(cat);
    if (!bySub) {
      bySub = new Map();
      groups.set(cat, bySub);
    }
    const bucket = bySub.get(sub);
    if (bucket) bucket.push(m);
    else bySub.set(sub, [m]);
  }

  // order X categories
  let categories = Array.from(groups.keys());
  if (dim.order === "natural") {
    categories.sort(dim.naturalSort ?? ((a, b) => a.localeCompare(b)));
  } else {
    // value-desc: order by total measure across all members in the category
    const total = (c: string) =>
      measure.compute(
        Array.from(groups.get(c)!.values()).flat(),
      ) ?? 0;
    categories.sort((a, b) => total(b) - total(a));
  }
  if (dim.limit) categories = categories.slice(0, dim.limit);

  // resolve series
  let series: ChartSeries[];
  if (breakdown) {
    // pick the top breakdown values across all categories
    const subTotals = new Map<string, number>();
    for (const bySub of groups.values()) {
      for (const [sub, ms] of bySub) {
        subTotals.set(sub, (subTotals.get(sub) ?? 0) + ms.length);
      }
    }
    const subKeys = Array.from(subTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_BREAKDOWN_SERIES)
      .map(([k]) => k);
    series = subKeys.map((k) => ({
      key: k,
      label: breakdown.formatCategory ? breakdown.formatCategory(k, t) : k,
    }));
  } else {
    series = [{ key: "__value__", label: t(measure.labelKey) }];
  }

  // build rows
  const data = categories.map((cat) => {
    const row: Record<string, string | number> = {
      category: dim.formatCategory ? dim.formatCategory(cat, t) : cat,
    };
    const bySub = groups.get(cat)!;
    for (const s of series) {
      const ms = bySub.get(s.key) ?? [];
      const v = measure.compute(ms);
      row[s.key] = v ?? 0;
    }
    return row;
  });

  return { data, series };
}
