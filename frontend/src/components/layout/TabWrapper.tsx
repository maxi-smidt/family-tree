import { ReactNode } from "react";
import { TabsContent } from "@/components/ui/tabs";

export const TabWrapper = ({
  children,
  value,
}: {
  children: ReactNode;
  value: string;
}) => (
  <TabsContent value={value} className="flex-1 min-h-0 m-0">
    {children}
  </TabsContent>
);
