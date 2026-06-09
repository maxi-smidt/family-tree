import { ReactNode, Suspense } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";

export const TabWrapper = ({
  children,
  value,
}: {
  children: ReactNode;
  value: string;
}) => (
  <TabsContent value={value} className="flex-1 min-h-0 m-0">
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <Spinner className="size-8" />
        </div>
      }
    >
      {children}
    </Suspense>
  </TabsContent>
);
