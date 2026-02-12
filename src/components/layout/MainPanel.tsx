import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GalleryView } from "@/components/gallery-view/GalleryView";
import { FlowPanel } from "@/components/tree-view/FlowPanel";
import { ListView } from "@/components/list-view/ListView";
import { useTranslation } from "react-i18next";

const TREE_VIEW = "tree-view";
const LIST_VIEW = "list-view";
const GALLERY_VIEW = "gallery-view";

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
      </TabsList>
      <TabsContent value={TREE_VIEW} className="flex-1 overflow-hidden">
        <FlowPanel />
      </TabsContent>
      <TabsContent value={LIST_VIEW} className="flex-1 overflow-hidden">
        <ListView />
      </TabsContent>
      <TabsContent value={GALLERY_VIEW} className="flex-1 overflow-hidden">
        <GalleryView />
      </TabsContent>
    </Tabs>
  );
};
