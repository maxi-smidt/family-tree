import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GalleryView } from "@/components/view/gallery-view/GalleryView";
import { FlowPanel } from "@/components/view/tree-view/FlowPanel";
import { ListView } from "@/components/view/list-view/ListView";
import { useTranslation } from "react-i18next";
import { DatabaseMergeView } from "@/components/view/database-merge-view/DatabaseMergeView";
import { DatabaseManagementView } from "@/components/view/database-management-view/DatabaseManagementView";
import { TimelineView } from "@/components/view/timeline-view/TimelineView";
import { TabWrapper } from "@/components/layout/TabWrapper";

const TREE_VIEW = "tree-view";
const LIST_VIEW = "list-view";
const GALLERY_VIEW = "gallery-view";
const TIMELINE_VIEW = "timeline-view";
const MERGE_VIEW = "merge-view";
const DATABASE_MANAGEMENT_VIEW = "database-management-view";

export const MainPanel = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "layout.main-panel",
  });

  return (
    <Tabs defaultValue={TREE_VIEW} className="h-full flex flex-col">
      <TabsList variant="line" className="ml-16 mt-3">
        <TabsTrigger value={TREE_VIEW}>{t("tree")}</TabsTrigger>
        <TabsTrigger value={LIST_VIEW}>{t("list")}</TabsTrigger>
        <TabsTrigger value={GALLERY_VIEW}>{t("gallery")}</TabsTrigger>
        <TabsTrigger value={TIMELINE_VIEW}>{t("timeline")}</TabsTrigger>
        <div className="border-l border-border self-stretch h-auto mx-2" />
        <TabsTrigger value={DATABASE_MANAGEMENT_VIEW}>
          {t("database-management")}
        </TabsTrigger>
        <TabsTrigger value={MERGE_VIEW}>{t("merge")}</TabsTrigger>
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
      <TabWrapper value={DATABASE_MANAGEMENT_VIEW}>
        <DatabaseManagementView />
      </TabWrapper>
      <TabWrapper value={MERGE_VIEW}>
        <DatabaseMergeView />
      </TabWrapper>
    </Tabs>
  );
};
