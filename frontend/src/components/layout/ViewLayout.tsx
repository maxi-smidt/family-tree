import { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ViewLayoutProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export const ViewLayout = ({
  title,
  action,
  children,
  contentClassName,
}: ViewLayoutProps) => {
  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-6 h-5">
        <h1 className="text-xl font-semibold leading-none">{title}</h1>
        {action && <div>{action}</div>}
      </div>
      <div className={cn("flex-1 overflow-auto", contentClassName)}>
        {children}
      </div>
    </div>
  );
};
