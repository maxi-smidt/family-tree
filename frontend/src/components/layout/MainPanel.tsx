import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GalleryView } from "@/components/view/gallery-view/GalleryView";
import { FlowPanel } from "@/components/view/tree-view/FlowPanel";
import { ListView } from "@/components/view/list-view/ListView";
import { useTranslation } from "react-i18next";
import { DatabaseManagementView } from "@/components/view/database-management-view/DatabaseManagementView";
import { TimelineView } from "@/components/view/timeline-view/TimelineView";
import { ActivityView } from "@/components/view/activity-view/ActivityView";
import { TabWrapper } from "@/components/layout/TabWrapper";
import { useIsMobile } from "@/hooks/useMobile";

const TREE_VIEW = "tree-view";
const LIST_VIEW = "list-view";
const GALLERY_VIEW = "gallery-view";
const TIMELINE_VIEW = "timeline-view";
const ACTIVITY_VIEW = "activity-view";
const DATABASE_MANAGEMENT_VIEW = "database-management-view";

const ALL_VIEWS = [
  TREE_VIEW,
  LIST_VIEW,
  GALLERY_VIEW,
  TIMELINE_VIEW,
  ACTIVITY_VIEW,
  DATABASE_MANAGEMENT_VIEW,
];
const MOBILE_VIEWS = [LIST_VIEW, TREE_VIEW];
const ACTIVE_TAB_STORAGE_KEY = "ft_active_tab";
const MOBILE_ACTIVE_TAB_STORAGE_KEY = "ft_mobile_active_tab";

export const MainPanel = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.main-panel",
  });
  const isMobile = useIsMobile();

  // Persist the selected tab so a page refresh keeps the user where they were.
  const [activeTab, setActiveTab] = useState<string>(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored && ALL_VIEWS.includes(stored) ? stored : TREE_VIEW;
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    localStorage.setItem(
      isMobile ? MOBILE_ACTIVE_TAB_STORAGE_KEY : ACTIVE_TAB_STORAGE_KEY,
      value,
    );
  };

  useEffect(() => {
    if (!isMobile) return;

    const stored = localStorage.getItem(MOBILE_ACTIVE_TAB_STORAGE_KEY);
    const nextTab =
      stored && MOBILE_VIEWS.includes(stored) ? stored : LIST_VIEW;
    if (activeTab !== nextTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, isMobile]);

  const visibleTabs = isMobile ? MOBILE_VIEWS : ALL_VIEWS;
  const effectiveTab =
    isMobile && !MOBILE_VIEWS.includes(activeTab) ? LIST_VIEW : activeTab;

  return (
    <Tabs
      value={effectiveTab}
      onValueChange={handleTabChange}
      className="h-full flex flex-col"
    >
      <TabsList
        variant={isMobile ? "default" : "line"}
        className={
          isMobile
            ? "ml-16 mr-4 mt-3 grid h-10 w-auto flex-none grid-cols-2"
            : "ml-16 mt-3"
        }
      >
        {visibleTabs.includes(LIST_VIEW) && (
          <TabsTrigger value={LIST_VIEW}>{t("list")}</TabsTrigger>
        )}
        {visibleTabs.includes(TREE_VIEW) && (
          <TabsTrigger value={TREE_VIEW}>{t("tree")}</TabsTrigger>
        )}
        {!isMobile && (
          <>
            <TabsTrigger value={GALLERY_VIEW}>{t("gallery")}</TabsTrigger>
            <TabsTrigger value={TIMELINE_VIEW}>{t("timeline")}</TabsTrigger>
            <TabsTrigger value={ACTIVITY_VIEW}>{t("activity")}</TabsTrigger>
            <div className="border-l border-border self-stretch h-auto mx-2" />
            <TabsTrigger value={DATABASE_MANAGEMENT_VIEW}>
              {t("database-management")}
            </TabsTrigger>
          </>
        )}
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
      <TabWrapper value={DATABASE_MANAGEMENT_VIEW}>
        <DatabaseManagementView />
      </TabWrapper>
    </Tabs>
  );
};
