import type { RelationType, RelationTypeDB } from "@/types/member";
import type {
  RelationStyleOverride,
  WorkerEdgeStyle,
} from "@/workers/treeProcessor.types";

export const RELATION_DASH_OPTIONS = [
  { value: "0", labelKey: "pattern-solid" },
  { value: "5,5", labelKey: "pattern-dashed" },
  { value: "2,4", labelKey: "pattern-dotted" },
] as const;

export interface RelationDefaultStyle {
  stroke: string;
  strokeDasharray: string;
  strokeWidth: number;
  colorInput: string;
}

export interface ResolvedRelationStyle extends WorkerEdgeStyle {
  stroke: string;
  strokeDasharray: string;
  strokeWidth: number;
  colorInput: string;
}

const DEFAULT_RELATION_STYLE: RelationDefaultStyle = {
  stroke: "var(--edge)",
  strokeDasharray: "5,5",
  strokeWidth: 2,
  colorInput: "#b7ad9c",
};

const BUILT_IN_RELATION_STYLES: Record<string, RelationDefaultStyle> = {
  parent: {
    stroke: "var(--edge)",
    strokeDasharray: "0",
    strokeWidth: 1.6,
    colorInput: "#b7ad9c",
  },
  married: {
    stroke: "var(--primary)",
    strokeDasharray: "0",
    strokeWidth: 2,
    colorInput: "#2f5d50",
  },
  divorced: {
    stroke: "var(--destructive)",
    strokeDasharray: "5,5",
    strokeWidth: 2,
    colorInput: "#dc2626",
  },
  partner: {
    stroke: "var(--primary)",
    strokeDasharray: "2,4",
    strokeWidth: 2,
    colorInput: "#2f5d50",
  },
  sibling: {
    stroke: "hsl(45 93% 47%)",
    strokeDasharray: "0",
    strokeWidth: 2,
    colorInput: "#eab308",
  },
};

function expandShortHex(value: string): string {
  return `#${value
    .slice(1)
    .split("")
    .map((char) => `${char}${char}`)
    .join("")}`;
}

export function toColorInputValue(
  color: string | null | undefined,
  fallback: string,
): string {
  if (!color) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return expandShortHex(color);
  return fallback;
}

export function getDefaultRelationStyle(
  typeId: RelationType,
): RelationDefaultStyle {
  return BUILT_IN_RELATION_STYLES[typeId] ?? DEFAULT_RELATION_STYLE;
}

export function getDefaultRelationEdgeStyle(
  typeId: RelationType,
): WorkerEdgeStyle {
  const { stroke, strokeDasharray, strokeWidth } =
    getDefaultRelationStyle(typeId);
  return { stroke, strokeDasharray, strokeWidth };
}

export function relationStyleOverrideFromType(
  type: RelationTypeDB,
): RelationStyleOverride {
  return {
    color: type.color,
    strokeWidth: type.stroke_width,
    strokeDasharray: type.stroke_dasharray,
  };
}

export function resolveRelationStyle(
  typeId: RelationType,
  override?: RelationStyleOverride,
): ResolvedRelationStyle {
  const defaults = getDefaultRelationStyle(typeId);
  const stroke = override?.color ?? defaults.stroke;
  return {
    stroke,
    strokeDasharray: override?.strokeDasharray ?? defaults.strokeDasharray,
    strokeWidth: override?.strokeWidth ?? defaults.strokeWidth,
    colorInput: toColorInputValue(stroke, defaults.colorInput),
  };
}

export function applyRelationStyleOverride(
  base: WorkerEdgeStyle,
  override?: RelationStyleOverride,
): WorkerEdgeStyle {
  if (!override) return base;

  const next: WorkerEdgeStyle = { ...base };
  if (override.color != null) next.stroke = override.color;
  if (override.strokeDasharray != null) {
    next.strokeDasharray = override.strokeDasharray;
  }
  if (override.strokeWidth != null) next.strokeWidth = override.strokeWidth;
  return next;
}
