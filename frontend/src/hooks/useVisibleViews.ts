import { useTabPreferences } from "@/hooks/useTabPreferences";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { filterViewsByRestrictions } from "@/lib/contentRestrictions";
import {
  DATABASE_MANAGEMENT_VIEW,
  FRIENDS_VIEW,
  IDENTITY_LINKS_VIEW,
  MIGRATION_REVIEW_VIEW,
  TREE_VIEW,
  resolveTabs,
  type ViewId,
} from "@/lib/tabs";

// Views that stay reachable when no workspace is open: the first-run tree
// placeholder plus everything that doesn't need a workspace.
export const NO_TREE_VIEWS: ViewId[] = [
  TREE_VIEW,
  DATABASE_MANAGEMENT_VIEW,
  FRIENDS_VIEW,
  MIGRATION_REVIEW_VIEW,
  IDENTITY_LINKS_VIEW,
];

/**
 * The views the current user can open right now, in their preferred order,
 * after applying hidden-tab preferences and the open workspace's content
 * restrictions. Shared by the left navigation and MainPanel.
 */
export function useVisibleViews() {
  const order = useTabPreferences((s) => s.order);
  const hidden = useTabPreferences((s) => s.hidden);
  const loaded = useTabPreferences((s) => s.loaded);
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  const restrictions = selectedTree?.restrictions ?? [];

  const { visible: allVisible } = resolveTabs(order, hidden);
  const visible = selectedTree
    ? filterViewsByRestrictions(allVisible, restrictions)
    : NO_TREE_VIEWS;

  return {
    visible,
    loaded,
    galleryAvailable: !restrictions.includes("gallery"),
    documentsAvailable: !restrictions.includes("sources"),
  };
}
