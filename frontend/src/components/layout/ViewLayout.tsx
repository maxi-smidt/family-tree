import { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ViewLayoutProps {
  title: string;
  action?: ReactNode;
  toolbar?: ReactNode;
  toolbarClassName?: string;
  children: ReactNode;
  contentClassName?: string;
}

export const ViewLayout = ({
  title,
  action,
  toolbar,
  toolbarClassName,
  children,
  contentClassName,
}: ViewLayoutProps) => {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4">
      {/* pr-12 clears the notification bell fixed at top-4 right-4 in Layout,
          mirroring the ml-16 other headers use to clear the sidebar trigger. */}
      <div className="flex-none flex items-center justify-between mb-6 h-5 pr-12">
        <h1 className="text-xl font-semibold leading-none">{title}</h1>
        {action && <div>{action}</div>}
      </div>
      {toolbar && (
        <div className={cn("flex-none", toolbarClassName)}>{toolbar}</div>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-auto",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
};
