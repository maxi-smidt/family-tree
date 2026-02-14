import { ReactNode } from "react";

interface ViewLayoutProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export const ViewLayout = ({ title, action, children }: ViewLayoutProps) => {
  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-6 h-5">
        <h1 className="text-xl font-semibold leading-none">{title}</h1>
        {action && <div>{action}</div>}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
};
