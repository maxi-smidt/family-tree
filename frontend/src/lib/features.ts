import { TREE_VIEW, ViewId } from "@/lib/tabs";

/**
 * Feature-flag catalog — mirrors the backend registry in
 * `backend/app/services/feature_service.py`. When adding a flag there, add
 * its name here and gate the UI entry points with `useFeature("<name>")`.
 */
export const ALL_FEATURES = [
  "gallery",
  "stories",
  "events",
  "activity_log",
  "quality_report",
  "statistics",
  "virtual_views",
  "gedcom",
  "sharing_invites",
] as const;

export type FeatureName = (typeof ALL_FEATURES)[number];

export function isFeatureName(value: string): value is FeatureName {
  return ALL_FEATURES.some((f) => f === value);
}

/** View tabs that only exist when their feature flag is enabled. */
export const VIEW_FEATURES: Partial<Record<ViewId, FeatureName>> = {
  "gallery-view": "gallery",
  "timeline-view": "events",
  "activity-view": "activity_log",
  "quality-report-view": "quality_report",
  "statistics-view": "statistics",
};

/**
 * Drop views whose feature flag is disabled. Falls back to the tree view
 * when flags (or tab preferences) would otherwise hide every tab.
 */
export function filterViewsByFeatures(
  views: ViewId[],
  features: readonly string[],
): ViewId[] {
  const enabled = new Set(features);
  const visible = views.filter((view) => {
    const required = VIEW_FEATURES[view];
    return required === undefined || enabled.has(required);
  });
  return visible.length > 0 ? visible : [TREE_VIEW];
}
