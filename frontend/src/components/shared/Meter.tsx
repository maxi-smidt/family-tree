import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MeterTone = "primary" | "warning" | "danger" | "muted";

const FILL: Record<MeterTone, string> = {
  primary: "bg-primary",
  warning: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/50",
};

interface MeterProps {
  /** 0–1; values outside the range are clamped. */
  value: number;
  label?: ReactNode;
  /** Right-aligned reading, e.g. "12 / 17". */
  valueLabel?: ReactNode;
  tone?: MeterTone;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  className?: string;
}

/**
 * A labelled horizontal meter: completeness, quota use, share of a total.
 * One bar style for every "how much of X" reading in the app.
 */
export function Meter({
  value,
  label,
  valueLabel,
  tone = "primary",
  ariaLabel,
  className,
}: MeterProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn("min-w-0", className)}>
      {(label || valueLabel) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
          <span className="min-w-0 truncate">{label}</span>
          {valueLabel && (
            <span
              className={cn(
                "shrink-0 tabular-nums",
                tone === "warning" ? "text-warning" : "text-muted-foreground",
                tone === "danger" && "text-destructive",
              )}
            >
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", FILL[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
