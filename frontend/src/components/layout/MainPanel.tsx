import { lazy, useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { TabWrapper } from "@/components/layout/TabWrapper";
import { MobileManagementSheet } from "@/components/layout/MobileManagementSheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { MediaSection } from "@/components/view/media-view/MediaView";

const FlowPanel = lazy(() =>
  import("@/components/view/tree-view/FlowPanel").then((m) => ({
    default: m.FlowPanel,
  })),
);
const ListView = lazy(() =>
  import("@/components/view/list-view/ListView").then((m) => ({
    default: m.ListView,
  })),
);
const MediaView = lazy(() =>
  import("@/components/view/media-view/MediaView").then((m) => ({
    default: m.MediaView,
  })),
);
const TimelineView = lazy(() =>
  import("@/components/view/timeline-view/TimelineView").then((m) => ({
    default: m.TimelineView,
  })),
);
const ActivityView = lazy(() =>
  import("@/components/view/activity-view/ActivityView").then((m) => ({
    default: m.ActivityView,
  })),
);
const DatabaseManagementView = lazy(() =>
  import("@/components/view/database-management-view/DatabaseManagementView").then(
    (m) => ({ default: m.DatabaseManagementView }),
  ),
);
const QualityReportView = lazy(() =>
  import("@/components/view/quality-report-view/QualityReportView").then(
    (m) => ({ default: m.QualityReportView }),
  ),
);
const StatisticsView = lazy(() =>
  import("@/components/view/statistics-view/StatisticsView").then((m) => ({
    default: m.StatisticsView,
  })),
);
const MapView = lazy(() =>
  import("@/components/view/map-view/MapView").then((m) => ({
    default: m.MapView,
  })),
);
const FriendsView = lazy(() =>
  import("@/components/view/friends-view/FriendsView").then((m) => ({
    default: m.FriendsView,
  })),
);
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useFriendStore, useIncomingFriendCount } from "@/hooks/useFriendStore";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useLegalStore } from "@/hooks/useLegalStore";
import { LEGAL_DEFAULT_LOCALE } from "@/lib/legalLocale";
import {
  DATABASE_MANAGEMENT_VIEW,
  FRIENDS_VIEW,
  MEDIA_VIEW,
  TREE_VIEW,
  ViewId,
  isViewId,
  resolveTabs,
} from "@/lib/tabs";
import { filterViewsByRestrictions } from "@/lib/contentRestrictions";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { usePresence } from "@/hooks/usePresence";
import { TreeBreadcrumb } from "@/components/layout/TreeBreadcrumb";
import { readMemberSheetDeepLink } from "@/utils/memberSheetState";

const ACTIVE_TAB_STORAGE_KEY = "ft_active_tab";
const ACTIVE_MEDIA_SECTION_STORAGE_KEY = "ft_active_media_section";

const NO_TREE_VIEWS: ViewId[] = [
  TREE_VIEW,
  DATABASE_MANAGEMENT_VIEW,
  FRIENDS_VIEW,
];

const VIEW_COMPONENTS: Omit<Record<ViewId, React.ReactNode>, "media-view"> = {
  "tree-view": <FlowPanel />,
  "list-view": <ListView />,
  "timeline-view": <TimelineView />,
  "map-view": <MapView />,
  "activity-view": <ActivityView />,
  "quality-report-view": <QualityReportView />,
  "statistics-view": <StatisticsView />,
  "database-management-view": <DatabaseManagementView />,
  "friends-view": <FriendsView />,
};

const MANAGEMENT_VIEWS = new Set<ViewId>(["database-management-view"]);

function readMediaSection(): MediaSection {
  return localStorage.getItem(ACTIVE_MEDIA_SECTION_STORAGE_KEY) === "documents"
    ? "documents"
    : "gallery";
}

export const MainPanel = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.main-panel",
  });
  const { t: tRoot } = useTranslation();

  // Announce this client's presence and track who else is in the tree.
  usePresence();

  const [activeTab, setActiveTab] = useState<ViewId>(() => {
    if (readMemberSheetDeepLink()) return TREE_VIEW;
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (stored === "gallery-view" || stored === "documents-view") {
      return MEDIA_VIEW;
    }
    return stored && isViewId(stored) ? stored : "tree-view";
  });
  const [activeMediaSection, setActiveMediaSection] =
    useState<MediaSection>(readMediaSection);

  const applyTab = (value: string) => {
    if (!isViewId(value)) return;
    setActiveTab(value);
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, value);
  };

  const guardNavigate = useUnsavedChangesStore((s) => s.guardNavigate);

  const handleTabChange = (value: string) => {
    guardNavigate(() => applyTab(value));
  };

  const { pendingView, clearPending } = useNavigationStore();
  useEffect(() => {
    if (pendingView !== null) {
      applyTab(pendingView);
      clearPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingView]);

  const selectedTreeId = useTreeStore((s) => s.selectedTree?.id);
  const hasOpenMemberSheet = useMemberSheetStore((s) =>
    selectedTreeId ? Boolean(s.openSheets[selectedTreeId]) : false,
  );
  useEffect(() => {
    if (hasOpenMemberSheet && activeTab !== TREE_VIEW) applyTab(TREE_VIEW);
  }, [activeTab, hasOpenMemberSheet]); // eslint-disable-line react-hooks/exhaustive-deps

  const user = useAuthStore((s) => s.user);
  const { order, hidden, loaded, load } = useTabPreferences();
  const loadTutorial = useTutorialStore((s) => s.load);
  const tutorialLoaded = useTutorialStore((s) => s.loaded);
  const tutorialCompleted = useTutorialStore((s) => s.completed);
  const tutorialRunning = useTutorialStore((s) => s.isRunning);
  const startTutorial = useTutorialStore((s) => s.start);
  const legalGateOpen =
    !!user?.legal_acceptance_required && !user?.legal_accepted;
  const loadLegalDocuments = useLegalStore((s) => s.load);
  const [manageOpen, setManageOpen] = useState(false);
  const loadIncomingFriends = useFriendStore((s) => s.loadIncoming);
  const incomingFriendCount = useIncomingFriendCount();

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (user) void loadTutorial();
  }, [user, loadTutorial]);

  // The legal gate takes priority over onboarding — it's a compliance
  // requirement, not a UX nicety — so it loads as soon as a user is
  // present, regardless of tutorial state.
  useEffect(() => {
    if (user && user.legal_acceptance_required && !user.legal_accepted) {
      void loadLegalDocuments(LEGAL_DEFAULT_LOCALE);
    }
  }, [user, loadLegalDocuments]);

  // Hold the tutorial until the blocking legal gate is accepted; otherwise the
  // tour highlights elements hidden behind the legal dialog (#615). Accepting
  // terms flips user.legal_accepted (via refreshMe), which re-runs this effect.
  useEffect(() => {
    if (
      tutorialLoaded &&
      !tutorialCompleted &&
      !tutorialRunning &&
      !legalGateOpen
    ) {
      startTutorial();
    }
  }, [
    tutorialLoaded,
    tutorialCompleted,
    tutorialRunning,
    legalGateOpen,
    startTutorial,
  ]);

  // Keep the Friends tab badge accurate without opening the tab.
  useEffect(() => {
    if (user) void loadIncomingFriends();
  }, [user, loadIncomingFriends]);

  const selectedTree = useTreeStore((s) => s.selectedTree);
  const restrictions = selectedTree?.restrictions ?? [];
  const galleryAvailable = !restrictions.includes("gallery");
  const documentsAvailable = !restrictions.includes("sources");

  const { ordered: _ordered, visible: allVisible } = resolveTabs(order, hidden);
  // A virtual tree exposes the same tabs as a normal tree (read-only,
  // aggregated live from its sources).
  // When no tree is selected, keep the first-run tree placeholder reachable
  // alongside Friends and Database Management.
  const visible = selectedTree
    ? filterViewsByRestrictions(allVisible, restrictions)
    : NO_TREE_VIEWS;
  const mobileViews = visible.filter((v) => !MANAGEMENT_VIEWS.has(v));

  // If the active tab is hidden and no pending navigation, move to first visible.
  useEffect(() => {
    if (loaded && pendingView === null && !visible.includes(activeTab)) {
      applyTab(visible[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, visible, activeTab, pendingView]);

  const viewLabels: Record<ViewId, string> = {
    "tree-view": t("tree"),
    "list-view": t("list"),
    "media-view": t("media"),
    "timeline-view": t("timeline"),
    "map-view": t("map"),
    "activity-view": t("activity"),
    "quality-report-view": t("quality-report"),
    "statistics-view": t("statistics"),
    "database-management-view": t("database-management"),
    "friends-view": t("friends"),
  };
  const selectMediaSection = (section: MediaSection) => {
    guardNavigate(() => {
      setActiveMediaSection(section);
      localStorage.setItem(ACTIVE_MEDIA_SECTION_STORAGE_KEY, section);
      applyTab(MEDIA_VIEW);
    });
  };
  const viewComponents: Record<ViewId, React.ReactNode> = {
    ...VIEW_COMPONENTS,
    "media-view": <MediaView section={activeMediaSection} />,
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="h-full flex flex-col"
    >
      <TreeBreadcrumb />
      <div
        className="ml-16 mr-4 mt-3 flex-none md:hidden flex items-center gap-2"
        data-tutorial="views-tabs-mobile"
      >
        <Select value={activeTab} onValueChange={handleTabChange}>
          <SelectTrigger className="h-10 flex-1 bg-background shadow-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {mobileViews.map((view) => (
              <SelectItem key={view} value={view}>
                {viewLabels[view]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={() => setManageOpen(true)}
          aria-label={tRoot("layout.mobile-management.manage")}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <TabsList
        variant="line"
        // TabsList is w-fit (shrink-to-fit), so a plain mr-* margin doesn't
        // stop it from growing under the notification bell (fixed top-4
        // right-4 in Layout) — cap its own width instead (100% minus ml-16's
        // 4rem and 4rem of bell clearance). Each TabsTrigger below is
        // flex-1 + min-w-0 + truncate so tabs shrink with an ellipsis under
        // that cap instead of overflowing; overflow-x-auto is just a safety
        // net for the pathological case where even truncated labels don't
        // fit (matches TreeBreadcrumb's approach to the same problem).
        className="ml-16 mt-3 hidden md:inline-flex max-w-[calc(100%-8rem)] overflow-x-auto"
        data-tutorial="views-tabs"
      >
        {visible.map((view) => (
          <span key={view} className="contents">
            {view === DATABASE_MANAGEMENT_VIEW && visible.length > 1 && (
              <div className="border-l border-border self-stretch h-auto mx-2" />
            )}
            {view === MEDIA_VIEW ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <TabsTrigger
                    value={view}
                    className={cn(
                      // flex-auto keeps the natural (content-proportional)
                      // basis instead of TabsTrigger's default flex-1
                      // (basis-0), which would force every tab to the same
                      // width — truncating long labels even when there's
                      // slack elsewhere in the row.
                      "flex-auto min-w-0",
                      activeTab === MEDIA_VIEW &&
                        "text-foreground after:opacity-100",
                    )}
                  >
                    <span className="truncate">{viewLabels[view]}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  </TabsTrigger>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {galleryAvailable && (
                    <DropdownMenuItem
                      onSelect={() => selectMediaSection("gallery")}
                    >
                      {tRoot("media-view.gallery")}
                    </DropdownMenuItem>
                  )}
                  {documentsAvailable && (
                    <DropdownMenuItem
                      onSelect={() => selectMediaSection("documents")}
                    >
                      {tRoot("media-view.documents")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <TabsTrigger value={view} className="flex-auto min-w-0">
                <span className="truncate">{viewLabels[view]}</span>
                {view === FRIENDS_VIEW && incomingFriendCount > 0 && (
                  <Badge variant="default" className="ml-1.5 px-1.5 shrink-0">
                    {incomingFriendCount}
                  </Badge>
                )}
              </TabsTrigger>
            )}
          </span>
        ))}
      </TabsList>

      {Object.entries(viewComponents).map(([view, component]) => (
        <TabWrapper key={view} value={view}>
          {component}
        </TabWrapper>
      ))}

      <MobileManagementSheet open={manageOpen} onOpenChange={setManageOpen} />
    </Tabs>
  );
};
