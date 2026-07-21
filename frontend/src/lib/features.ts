import { MEDIA_VIEW, TREE_VIEW, ViewId } from "@/lib/tabs";

/**
 * Feature-flag catalog — mirrors the backend registry in
 * `backend/app/services/feature_service.py`. When adding a flag there, add
 * its name here and gate the UI entry points with `useFeature("<name>")`.
 */
export const ALL_FEATURES = [
  "gallery",
  "stories",
  "events",
  "map",
  "sources",
  "activity_log",
  "quality_report",
  "statistics",
  "virtual_views",
  "gedcom",
  "sharing_invites",
  "onboarding_tour",
  "tree_links",
  "presence",
  "research_tasks",
  "notifications",
] as const;

export type FeatureName = (typeof ALL_FEATURES)[number];

export function isFeatureName(value: string): value is FeatureName {
  return ALL_FEATURES.some((f) => f === value);
}

/** View tabs that only exist when their feature flag is enabled. */
export const VIEW_FEATURES: Partial<Record<ViewId, FeatureName>> = {
  "timeline-view": "events",
  "map-view": "map",
  "activity-view": "activity_log",
  "quality-report-view": "quality_report",
  "statistics-view": "statistics",
};

/** View tabs that map to a restrictable domain. */
export const VIEW_DOMAINS: Partial<Record<ViewId, string>> = {
  "tree-view": "tree",
  "list-view": "tree",
  "timeline-view": "events",
  "map-view": "map",
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
    if (view === MEDIA_VIEW) {
      return enabled.has("gallery") || enabled.has("sources");
    }
    const required = VIEW_FEATURES[view];
    return required === undefined || enabled.has(required);
  });
  return visible.length > 0 ? visible : [TREE_VIEW];
}

/**
 * Drop views whose domain is in the member's restriction list. Falls back to
 * the tree view when restrictions would otherwise hide every tab.
 */
export function filterViewsByRestrictions(
  views: ViewId[],
  restrictions: readonly string[],
): ViewId[] {
  if (restrictions.length === 0) return views;
  const hidden = new Set(restrictions);
  const visible = views.filter((view) => {
    if (view === MEDIA_VIEW) {
      return !hidden.has("gallery") || !hidden.has("sources");
    }
    const domain = VIEW_DOMAINS[view];
    return domain === undefined || !hidden.has(domain);
  });
  return visible.length > 0 ? visible : [TREE_VIEW];
}
