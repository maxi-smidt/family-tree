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
  <TabsContent value={value} className="m-0 flex min-h-0 flex-1 flex-col">
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
