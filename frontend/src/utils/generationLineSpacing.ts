import { GRID_SIZE } from "@/constants";

// Generation-line spacing must remain a multiple of the layout snap grid
// so the NODE_HEIGHT / 2 phase in GenerationLines keeps node centers on rules.
export const GENERATION_LINE_GAP_STEP = GRID_SIZE;

// Row pitch of the auto-layout for the compact 220×68 cards: "Arrange" puts
// consecutive generations 325px apart, so the default spacing draws one rule
// per generation and the larger options one rule every two or three.
export const GENERATION_ROW_PITCH = 325;
export const DEFAULT_GENERATION_LINE_GAP = GENERATION_ROW_PITCH;

export const GENERATION_LINE_SPACING_OPTIONS = [
  { value: "none", gap: null },
  { value: "xs", gap: 175 },
  { value: "s", gap: GENERATION_ROW_PITCH },
  { value: "m", gap: GENERATION_ROW_PITCH * 2 },
  { value: "l", gap: GENERATION_ROW_PITCH * 3 },
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
