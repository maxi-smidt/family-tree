export const TREE_VIEW = "tree-view";
export const LIST_VIEW = "list-view";
export const GALLERY_VIEW = "gallery-view";
export const TIMELINE_VIEW = "timeline-view";
export const MAP_VIEW = "map-view";
export const ACTIVITY_VIEW = "activity-view";
export const QUALITY_REPORT_VIEW = "quality-report-view";
export const STATISTICS_VIEW = "statistics-view";
export const DATABASE_MANAGEMENT_VIEW = "database-management-view";
export const FRIENDS_VIEW = "friends-view";

export const ALL_VIEWS = [
  TREE_VIEW,
  LIST_VIEW,
  GALLERY_VIEW,
  TIMELINE_VIEW,
  MAP_VIEW,
  ACTIVITY_VIEW,
  QUALITY_REPORT_VIEW,
  STATISTICS_VIEW,
  DATABASE_MANAGEMENT_VIEW,
  FRIENDS_VIEW,
] as const;

export type ViewId = (typeof ALL_VIEWS)[number];

export function isViewId(value: string): value is ViewId {
  return ALL_VIEWS.some((v) => v === value);
}

/**
 * Reconcile server-stored order/hidden lists with the canonical ALL_VIEWS.
 * Unknown IDs (e.g. from a future version) are silently dropped.
 * If every tab would be hidden, falls back to showing TREE_VIEW.
 */
export function resolveTabs(
  order: string[],
  hidden: string[],
): { ordered: ViewId[]; visible: ViewId[] } {
  const validOrder = order.filter(isViewId) as ViewId[];
  const missing = ALL_VIEWS.filter((v) => !validOrder.includes(v));
  const ordered: ViewId[] = [...validOrder, ...missing];

  const hiddenSet = new Set(hidden.filter(isViewId));
  let visible = ordered.filter((v) => !hiddenSet.has(v));
  if (visible.length === 0) visible = [TREE_VIEW];

  return { ordered, visible };
}
