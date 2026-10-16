import { ReactNode } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";

interface ViewLayoutProps {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  toolbar?: ReactNode;
  toolbarClassName?: string;
  children: ReactNode;
  contentClassName?: string;
}

export const ViewLayout = ({
  title,
  subtitle,
  action,
  toolbar,
  toolbarClassName,
  children,
  contentClassName,
}: ViewLayoutProps) => {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader title={title} subtitle={subtitle} actions={action} />
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-4 pb-4 md:px-6 md:pt-5">
        {toolbar && (
          <div className={cn("mb-4 flex-none", toolbarClassName)}>
            {toolbar}
          </div>
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
    </div>
  );
};
