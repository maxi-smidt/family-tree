import { GRID_SIZE } from "@/constants";

// Generation-line spacing must remain a multiple of the 50px layout snap grid
// so the NODE_HEIGHT / 2 phase in GenerationLines keeps node centers on rules.
export const GENERATION_LINE_GAP_STEP = GRID_SIZE;
export const MIN_GENERATION_LINE_GAP = 250;
export const MAX_GENERATION_LINE_GAP = 1000;
export const DEFAULT_GENERATION_LINE_GAP = 500;

export const GENERATION_LINE_GAPS = Array.from(
  {
    length:
      (MAX_GENERATION_LINE_GAP - MIN_GENERATION_LINE_GAP) /
        GENERATION_LINE_GAP_STEP +
      1,
  },
  (_, index) => MIN_GENERATION_LINE_GAP + index * GENERATION_LINE_GAP_STEP,
);

export function isGenerationLineGap(gap: number): boolean {
  return GENERATION_LINE_GAPS.includes(gap);
}

export function getGenerationLineGap(gap: number | undefined): number {
  return gap !== undefined && isGenerationLineGap(gap)
    ? gap
    : DEFAULT_GENERATION_LINE_GAP;
}
