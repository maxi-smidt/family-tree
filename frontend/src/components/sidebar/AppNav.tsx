import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  Clock,
  FileText,
  Folder,
  GitMerge,
  Image,
  Link2,
  Map as MapIcon,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { MobileManagementSheet } from "@/components/layout/MobileManagementSheet";
import {
  useActiveViewStore,
  type MediaSection,
} from "@/hooks/useActiveViewStore";
import { useVisibleViews } from "@/hooks/useVisibleViews";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useIncomingFriendCount } from "@/hooks/useFriendStore";
import { usePendingMigrationReviewCount } from "@/hooks/useMigrationReviewStore";
import { useIncomingIdentityClaimCount } from "@/hooks/useIdentityLinkStore";
import { MEDIA_VIEW, type ViewId } from "@/lib/tabs";

interface NavEntry {
  key: string;
  view: ViewId;
  section?: MediaSection;
  icon: LucideIcon;
  label: string;
  badge?: number;
  badgeTone?: "warn" | "accent";
}

const GROUPS: { id: "explore" | "insights" | "workspace"; views: ViewId[] }[] =
  [
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
      views: [
        "database-management-view",
        "friends-view",
        "identity-links-view",
        "migration-review-view",
      ],
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
  "migration-review-view": GitMerge,
};

/**
 * The app's primary navigation: every view, grouped into Explore / Insights /
 * Workspace, in the left sidebar. Replaces the old top tab strip, whose
 * twelve tabs no longer fit and were truncated to "Tr…", "L…".
 */
export const AppNav = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "layout" });
  const { isMobile, setOpenMobile } = useSidebar();
  const activeView = useActiveViewStore((s) => s.activeView);
  const mediaSection = useActiveViewStore((s) => s.mediaSection);
  const setActiveView = useActiveViewStore((s) => s.setActiveView);
  const setMediaSection = useActiveViewStore((s) => s.setMediaSection);
  const guardNavigate = useUnsavedChangesStore((s) => s.guardNavigate);
  const { visible, galleryAvailable, documentsAvailable } = useVisibleViews();
  const friendCount = useIncomingFriendCount();
  const migrationCount = usePendingMigrationReviewCount();
  const identityCount = useIncomingIdentityClaimCount();
  const [manageOpen, setManageOpen] = useState(false);

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
    "migration-review-view": t("main-panel.migration-review"),
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
          : view === "migration-review-view"
            ? migrationCount
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
      if (isMobile) setOpenMobile(false);
    });
  };

  const isActive = (entry: NavEntry) =>
    activeView === entry.view &&
    (entry.section === undefined || entry.section === mediaSection);

  return (
    <nav aria-label={t("nav.aria-label")} data-tutorial="views-tabs">
      {GROUPS.map((group) => {
        const entries = entriesFor(group.views);
        if (entries.length === 0) return null;
        return (
          <SidebarGroup key={group.id} className="py-1">
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider">
              {t(`nav.${group.id}`)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {entries.map((entry) => {
                  const Icon = entry.icon;
                  const active = isActive(entry);
                  return (
                    <SidebarMenuItem key={entry.key}>
                      <SidebarMenuButton
                        isActive={active}
                        aria-current={active ? "page" : undefined}
                        onClick={() => open(entry)}
                        className="h-9 gap-2.5 font-medium text-sidebar-foreground/80 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-xs [&[data-active=true]>svg]:text-primary"
                      >
                        <Icon />
                        <span>{entry.label}</span>
                      </SidebarMenuButton>
                      {!!entry.badge && entry.badge > 0 && (
                        <SidebarMenuBadge
                          className={
                            entry.badgeTone === "accent"
                              ? "bg-primary-soft text-primary"
                              : "bg-warning-soft text-warning"
                          }
                        >
                          {entry.badge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
      {isMobile && (
        <SidebarGroup className="py-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="h-9 gap-2.5 font-medium"
                onClick={() => setManageOpen(true)}
              >
                <SlidersHorizontal />
                <span>{t("nav.manage")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <MobileManagementSheet
            open={manageOpen}
            onOpenChange={setManageOpen}
          />
        </SidebarGroup>
      )}
    </nav>
  );
};
