import { MEDIA_VIEW, TREE_VIEW, ViewId } from "@/lib/tabs";

/** View tabs that map to a restrictable content domain. */
export const VIEW_DOMAINS: Partial<Record<ViewId, string>> = {
  "tree-view": "tree",
  "list-view": "tree",
  "timeline-view": "events",
  "map-view": "map",
};

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
