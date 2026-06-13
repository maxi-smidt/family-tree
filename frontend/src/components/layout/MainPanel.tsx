import { lazy, useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { TabWrapper } from "@/components/layout/TabWrapper";
import { MobileManagementSheet } from "@/components/layout/MobileManagementSheet";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";

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
const GalleryView = lazy(() =>
  import("@/components/view/gallery-view/GalleryView").then((m) => ({
    default: m.GalleryView,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import {
  DATABASE_MANAGEMENT_VIEW,
  TREE_VIEW,
  LIST_VIEW,
  ViewId,
  isViewId,
  resolveTabs,
} from "@/lib/tabs";
import { filterViewsByFeatures } from "@/lib/features";
import { useTreeStore } from "@/hooks/useTreeStore";
import { isVirtualId } from "@/hooks/useTreeStore";

const VIRTUAL_VIEW_TABS = new Set<ViewId>([
  TREE_VIEW,
  LIST_VIEW,
  DATABASE_MANAGEMENT_VIEW,
]);

const ACTIVE_TAB_STORAGE_KEY = "ft_active_tab";

const VIEW_COMPONENTS: Record<ViewId, React.ReactNode> = {
  "tree-view": <FlowPanel />,
  "list-view": <ListView />,
  "gallery-view": <GalleryView />,
  "timeline-view": <TimelineView />,
  "map-view": <MapView />,
  "activity-view": <ActivityView />,
  "quality-report-view": <QualityReportView />,
  "statistics-view": <StatisticsView />,
  "database-management-view": <DatabaseManagementView />,
};

const MANAGEMENT_VIEWS = new Set<ViewId>(["database-management-view"]);

export const MainPanel = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.main-panel",
  });
  const { t: tRoot } = useTranslation();

  const [activeTab, setActiveTab] = useState<ViewId>(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored && isViewId(stored) ? stored : "tree-view";
  });

  const handleTabChange = (value: string) => {
    if (!isViewId(value)) return;
    setActiveTab(value);
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, value);
  };

  const { pendingView, clearPending } = useNavigationStore();
  useEffect(() => {
    if (pendingView !== null) {
      handleTabChange(pendingView);
      clearPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingView]);

  const user = useAuthStore((s) => s.user);
  const features = useAuthStore((s) => s.features);
  const { order, hidden, loaded, load } = useTabPreferences();
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const isVirtualActive = !!selectedTree?.id && isVirtualId(selectedTree.id);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const { ordered: _ordered, visible: allVisible } = resolveTabs(order, hidden);
  const enabledVisible = filterViewsByFeatures(allVisible, features);
  const visible = isVirtualActive
    ? enabledVisible.filter((v) => VIRTUAL_VIEW_TABS.has(v))
    : enabledVisible;
  const mobileViews = visible.filter((v) => !MANAGEMENT_VIEWS.has(v));

  // If the active tab is hidden and no pending navigation, move to first visible.
  useEffect(() => {
    if (loaded && pendingView === null && !visible.includes(activeTab)) {
      handleTabChange(visible[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, visible, activeTab, pendingView]);

  const viewLabels: Record<ViewId, string> = {
    "tree-view": t("tree"),
    "list-view": t("list"),
    "gallery-view": t("gallery"),
    "timeline-view": t("timeline"),
    "map-view": t("map"),
    "activity-view": t("activity"),
    "quality-report-view": t("quality-report"),
    "statistics-view": t("statistics"),
    "database-management-view": t("database-management"),
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="h-full flex flex-col"
    >
      <div className="ml-16 mr-4 mt-3 flex-none md:hidden flex items-center gap-2">
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

      <TabsList variant="line" className="ml-16 mt-3 hidden md:inline-flex">
        {visible.map((view) => (
          <span key={view} className="contents">
            {view === DATABASE_MANAGEMENT_VIEW && visible.length > 1 && (
              <div className="border-l border-border self-stretch h-auto mx-2" />
            )}
            <TabsTrigger value={view}>{viewLabels[view]}</TabsTrigger>
          </span>
        ))}
      </TabsList>

      {Object.entries(VIEW_COMPONENTS).map(([view, component]) => (
        <TabWrapper key={view} value={view}>
          {component}
        </TabWrapper>
      ))}

      <MobileManagementSheet open={manageOpen} onOpenChange={setManageOpen} />
    </Tabs>
  );
};
