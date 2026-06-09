import { lazy, useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { TabWrapper } from "@/components/layout/TabWrapper";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigationStore } from "@/hooks/useNavigationStore";

const TREE_VIEW = "tree-view";
const LIST_VIEW = "list-view";
const GALLERY_VIEW = "gallery-view";
const TIMELINE_VIEW = "timeline-view";
const ACTIVITY_VIEW = "activity-view";
const QUALITY_REPORT_VIEW = "quality-report-view";
const DATABASE_MANAGEMENT_VIEW = "database-management-view";

const ALL_VIEWS = [
  TREE_VIEW,
  LIST_VIEW,
  GALLERY_VIEW,
  TIMELINE_VIEW,
  ACTIVITY_VIEW,
  QUALITY_REPORT_VIEW,
  DATABASE_MANAGEMENT_VIEW,
] as const;
type ViewId = (typeof ALL_VIEWS)[number];
const ACTIVE_TAB_STORAGE_KEY = "ft_active_tab";

export const MainPanel = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.main-panel",
  });

  // Persist the selected tab so a page refresh keeps the user where they were.
  const [activeTab, setActiveTab] = useState<ViewId>(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored && isViewId(stored) ? stored : TREE_VIEW;
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

  const viewLabels = {
    [TREE_VIEW]: t("tree"),
    [LIST_VIEW]: t("list"),
    [GALLERY_VIEW]: t("gallery"),
    [TIMELINE_VIEW]: t("timeline"),
    [ACTIVITY_VIEW]: t("activity"),
    [QUALITY_REPORT_VIEW]: t("quality-report"),
    [DATABASE_MANAGEMENT_VIEW]: t("database-management"),
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="h-full flex flex-col"
    >
      <div className="ml-16 mr-4 mt-3 flex-none md:hidden">
        <Select value={activeTab} onValueChange={handleTabChange}>
          <SelectTrigger className="h-10 w-full bg-background shadow-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {ALL_VIEWS.map((view) => (
              <SelectItem key={view} value={view}>
                {viewLabels[view]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TabsList variant="line" className="ml-16 mt-3 hidden md:inline-flex">
        <TabsTrigger value={TREE_VIEW}>{viewLabels[TREE_VIEW]}</TabsTrigger>
        <TabsTrigger value={LIST_VIEW}>{viewLabels[LIST_VIEW]}</TabsTrigger>
        <TabsTrigger value={GALLERY_VIEW}>
          {viewLabels[GALLERY_VIEW]}
        </TabsTrigger>
        <TabsTrigger value={TIMELINE_VIEW}>
          {viewLabels[TIMELINE_VIEW]}
        </TabsTrigger>
        <TabsTrigger value={ACTIVITY_VIEW}>
          {viewLabels[ACTIVITY_VIEW]}
        </TabsTrigger>
        <TabsTrigger value={QUALITY_REPORT_VIEW}>
          {viewLabels[QUALITY_REPORT_VIEW]}
        </TabsTrigger>
        <div className="border-l border-border self-stretch h-auto mx-2" />
        <TabsTrigger value={DATABASE_MANAGEMENT_VIEW}>
          {viewLabels[DATABASE_MANAGEMENT_VIEW]}
        </TabsTrigger>
      </TabsList>
      <TabWrapper value={TREE_VIEW}>
        <FlowPanel />
      </TabWrapper>
      <TabWrapper value={LIST_VIEW}>
        <ListView />
      </TabWrapper>
      <TabWrapper value={GALLERY_VIEW}>
        <GalleryView />
      </TabWrapper>
      <TabWrapper value={TIMELINE_VIEW}>
        <TimelineView />
      </TabWrapper>
      <TabWrapper value={ACTIVITY_VIEW}>
        <ActivityView />
      </TabWrapper>
      <TabWrapper value={QUALITY_REPORT_VIEW}>
        <QualityReportView />
      </TabWrapper>
      <TabWrapper value={DATABASE_MANAGEMENT_VIEW}>
        <DatabaseManagementView />
      </TabWrapper>
    </Tabs>
  );
};

function isViewId(value: string): value is ViewId {
  return ALL_VIEWS.some((view) => view === value);
}
