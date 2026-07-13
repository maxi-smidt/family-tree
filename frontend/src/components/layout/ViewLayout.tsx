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
      <div className="flex-none flex items-center justify-between mb-6 h-5">
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
