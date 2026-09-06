export const TREE_VIEW = "tree-view";
export const LIST_VIEW = "list-view";
export const MEDIA_VIEW = "media-view";
export const TIMELINE_VIEW = "timeline-view";
export const MAP_VIEW = "map-view";
export const ACTIVITY_VIEW = "activity-view";
export const QUALITY_REPORT_VIEW = "quality-report-view";
export const STATISTICS_VIEW = "statistics-view";
export const DATABASE_MANAGEMENT_VIEW = "database-management-view";
export const FRIENDS_VIEW = "friends-view";
export const MIGRATION_REVIEW_VIEW = "migration-review-view";
export const IDENTITY_LINKS_VIEW = "identity-links-view";

export const ALL_VIEWS = [
  TREE_VIEW,
  LIST_VIEW,
  MEDIA_VIEW,
  TIMELINE_VIEW,
  MAP_VIEW,
  ACTIVITY_VIEW,
  QUALITY_REPORT_VIEW,
  STATISTICS_VIEW,
  DATABASE_MANAGEMENT_VIEW,
  FRIENDS_VIEW,
  MIGRATION_REVIEW_VIEW,
  IDENTITY_LINKS_VIEW,
] as const;

export type ViewId = (typeof ALL_VIEWS)[number];

const LEGACY_GALLERY_VIEW = "gallery-view";
const LEGACY_DOCUMENTS_VIEW = "documents-view";

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
  // Gallery and Documents used to be separate top-level tabs. Preserve their
  // first saved position as Media when upgrading existing preferences.
  const validOrder = order.reduce<ViewId[]>((views, value) => {
    const view =
      value === LEGACY_GALLERY_VIEW || value === LEGACY_DOCUMENTS_VIEW
        ? MEDIA_VIEW
        : isViewId(value)
          ? value
          : null;
    if (view && !views.includes(view)) views.push(view);
    return views;
  }, []);
  const missing = ALL_VIEWS.filter((v) => !validOrder.includes(v));
  const ordered: ViewId[] = [...validOrder, ...missing];

  const hiddenSet = new Set(hidden.filter(isViewId));
  if (
    hidden.includes(LEGACY_GALLERY_VIEW) &&
    hidden.includes(LEGACY_DOCUMENTS_VIEW)
  ) {
    hiddenSet.add(MEDIA_VIEW);
  }
  let visible = ordered.filter((v) => !hiddenSet.has(v));
  if (visible.length === 0) visible = [TREE_VIEW];

  return { ordered, visible };
}
