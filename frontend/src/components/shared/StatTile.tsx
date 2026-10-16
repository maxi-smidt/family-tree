import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small trailing unit next to the value, e.g. "years". */
  unit?: string;
  /** One quiet line of context under the value. */
  note?: ReactNode;
  className?: string;
}

/**
 * A headline number on a card — label, big value, one line of context.
 * Used for the KPI rows on Statistics, Data quality and Workspaces.
 */
export function StatTile({ label, value, unit, note, className }: StatTileProps) {
  return (
    <Card className={cn("gap-0 px-5", className)}>
      <p className="mb-2.5 text-[13px] font-semibold text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-[40px] leading-[1.05] font-medium tracking-tight tabular-nums">
        {value}
        {unit && (
          <span className="ml-1 text-lg font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
      {note && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">{note}</p>
      )}
    </Card>
  );
}
