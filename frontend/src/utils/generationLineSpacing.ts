import { GRID_SIZE } from "@/constants";

// Generation-line spacing must remain a multiple of the 50px layout snap grid
// so the NODE_HEIGHT / 2 phase in GenerationLines keeps node centers on rules.
export const GENERATION_LINE_GAP_STEP = GRID_SIZE;
export const DEFAULT_GENERATION_LINE_GAP = 500;

export const GENERATION_LINE_SPACING_OPTIONS = [
  { value: "none", gap: null },
  { value: "xs", gap: 250 },
  { value: "s", gap: 500 },
  { value: "m", gap: 750 },
  { value: "l", gap: 1000 },
  { value: "xl", gap: 1250 },
] as const;

export type GenerationLineSpacing =
  (typeof GENERATION_LINE_SPACING_OPTIONS)[number]["value"];

export type GenerationLineGap =
  (typeof GENERATION_LINE_SPACING_OPTIONS)[number]["gap"];

export function isGenerationLineGap(gap: unknown): gap is GenerationLineGap {
  return GENERATION_LINE_SPACING_OPTIONS.some((option) => option.gap === gap);
}

export function getGenerationLineGap(gap: unknown): GenerationLineGap {
  return isGenerationLineGap(gap) ? gap : DEFAULT_GENERATION_LINE_GAP;
}

export function getGenerationLineSpacing(gap: unknown): GenerationLineSpacing {
  const resolvedGap = getGenerationLineGap(gap);
  return (
    GENERATION_LINE_SPACING_OPTIONS.find((option) => option.gap === resolvedGap)
      ?.value ?? "s"
  );
}

export function getGenerationLineGapForSpacing(
  spacing: GenerationLineSpacing,
): GenerationLineGap {
  const option = GENERATION_LINE_SPACING_OPTIONS.find(
    (option) => option.value === spacing,
  );
  return option ? option.gap : DEFAULT_GENERATION_LINE_GAP;
}
