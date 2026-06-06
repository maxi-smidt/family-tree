import { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
};

export const SettingsField = ({ label, children }: Props) => {
  return (
    <div className="flex flex-col gap-1.5 w-full p-2">
      <label className="text-xs font-medium text-muted-foreground ml-1">
        {label}
      </label>
      {children}
    </div>
  );
};
