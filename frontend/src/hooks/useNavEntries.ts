import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  Clock,
  FileText,
  Folder,
  Image,
  Link2,
  Map as MapIcon,
  Network,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  useActiveViewStore,
  type MediaSection,
} from "@/hooks/useActiveViewStore";
import { useVisibleViews } from "@/hooks/useVisibleViews";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useIncomingFriendCount } from "@/hooks/useFriendStore";
import { useIncomingIdentityClaimCount } from "@/hooks/useIdentityLinkStore";
import { MEDIA_VIEW, type ViewId } from "@/lib/tabs";

export interface NavEntry {
  key: string;
  view: ViewId;
  section?: MediaSection;
  icon: LucideIcon;
  label: string;
  badge?: number;
  badgeTone?: "warn" | "accent";
}

export const NAV_GROUPS: {
  id: "explore" | "insights" | "workspace";
  views: ViewId[];
}[] = [
  {
    id: "explore",
    views: [
      "tree-view",
      "list-view",
      "timeline-view",
      "map-view",
      "media-view",
    ],
  },
  {
    id: "insights",
    views: ["statistics-view", "quality-report-view", "activity-view"],
  },
  {
    id: "workspace",
    views: ["database-management-view", "friends-view", "identity-links-view"],
  },
];

const ICONS: Record<ViewId, LucideIcon> = {
  "tree-view": Network,
  "list-view": Users,
  "timeline-view": Clock,
  "map-view": MapIcon,
  "media-view": Image,
  "statistics-view": BarChart3,
  "quality-report-view": ShieldCheck,
  "activity-view": Activity,
  "database-management-view": Folder,
  "friends-view": UserPlus,
  "identity-links-view": Link2,
};

/**
 * The navigable destinations (views, with Media split into Gallery and
 * Documents), grouped as in the sidebar. Shared by the sidebar navigation and
 * the search palette's "Go to" section so both list the same places.
 */
export function useNavEntries(onNavigate?: () => void) {
  const { t } = useTranslation(undefined, { keyPrefix: "layout" });
  const activeView = useActiveViewStore((s) => s.activeView);
  const mediaSection = useActiveViewStore((s) => s.mediaSection);
  const setActiveView = useActiveViewStore((s) => s.setActiveView);
  const setMediaSection = useActiveViewStore((s) => s.setMediaSection);
  const guardNavigate = useUnsavedChangesStore((s) => s.guardNavigate);
  const { visible, galleryAvailable, documentsAvailable } = useVisibleViews();
  const friendCount = useIncomingFriendCount();
  const identityCount = useIncomingIdentityClaimCount();
  const labels: Record<ViewId, string> = {
    "tree-view": t("main-panel.tree"),
    "list-view": t("main-panel.list"),
    "media-view": t("main-panel.media"),
    "timeline-view": t("main-panel.timeline"),
    "map-view": t("main-panel.map"),
    "activity-view": t("main-panel.activity"),
    "quality-report-view": t("main-panel.quality-report"),
    "statistics-view": t("main-panel.statistics"),
    "database-management-view": t("main-panel.database-management"),
    "friends-view": t("main-panel.friends"),
    "identity-links-view": t("main-panel.identity-links"),
  };

  const entriesFor = (views: ViewId[]): NavEntry[] => {
    // Keep the user's preferred order (tab preferences) within each group.
    const ordered = visible.filter((v) => views.includes(v));
    return ordered.flatMap((view): NavEntry[] => {
      if (view === MEDIA_VIEW) {
        const media: NavEntry[] = [];
        if (galleryAvailable)
          media.push({
            key: "media-gallery",
            view,
            section: "gallery",
            icon: Image,
            label: t("nav.gallery"),
          });
        if (documentsAvailable)
          media.push({
            key: "media-documents",
            view,
            section: "documents",
            icon: FileText,
            label: t("nav.documents"),
          });
        return media;
      }
      const badge =
        view === "friends-view"
          ? friendCount
          : view === "identity-links-view"
            ? identityCount
            : 0;
      return [
        {
          key: view,
          view,
          icon: ICONS[view],
          label: labels[view],
          badge,
          badgeTone: view === "friends-view" ? "accent" : "warn",
        },
      ];
    });
  };

  const open = (entry: NavEntry) => {
    guardNavigate(() => {
      if (entry.section) setMediaSection(entry.section);
      setActiveView(entry.view);
      onNavigate?.();
    });
  };

  const isActive = (entry: NavEntry) =>
    activeView === entry.view &&
    (entry.section === undefined || entry.section === mediaSection);

  const groups = NAV_GROUPS.map((group) => ({
    id: group.id,
    entries: entriesFor(group.views),
  })).filter((group) => group.entries.length > 0);

  return { groups, open, isActive };
}
