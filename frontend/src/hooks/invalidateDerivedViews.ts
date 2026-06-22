import { useStatisticsStore } from "@/hooks/useStatisticsStore";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useActivityStore } from "@/hooks/useActivityStore";

/**
 * Clear all three derived-view stores after any member-level mutation.
 * The stores guard on `!report` / `!initialized` at mount, so clearing
 * forces a fresh fetch the next time the view is opened.
 */
export function invalidateDerivedViews(): void {
  useStatisticsStore.getState().clear();
  useQualityReportStore.getState().clear();
  useActivityStore.getState().clear();
}

/**
 * Clear only the Activity store after non-member mutations (gallery, events,
 * stories, sources). Those mutations don't change member counts or data
 * completeness, so Statistics and QualityReport stay valid.
 */
export function invalidateActivityView(): void {
  useActivityStore.getState().clear();
}
