import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlowPanel } from "@/components/flowpanel/FlowPanel";

const TREE_VIEW = "tree-view";
const LIST_VIEW = "list-view";

export const MainPanel = () => {
  return (
    <Tabs defaultValue={TREE_VIEW} className="h-full">
      <TabsList variant="line" className="ml-16 mt-3">
        <TabsTrigger value={TREE_VIEW}>Tree</TabsTrigger>
        <TabsTrigger value={LIST_VIEW}>List</TabsTrigger>
      </TabsList>
      <TabsContent value={TREE_VIEW}>
        <FlowPanel />
      </TabsContent>
      <TabsContent value={LIST_VIEW}>TODO</TabsContent>
    </Tabs>
  );
};
