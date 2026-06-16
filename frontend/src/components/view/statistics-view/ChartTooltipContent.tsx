import type { ReactNode } from "react";
import type {
  TooltipPayload,
  TooltipPayloadEntry,
  TooltipValueType,
} from "recharts";

interface ChartTooltipContentProps {
  active?: boolean;
  hideLabel?: boolean;
  label?: string | number;
  labelFormatter?: (label: string | number | undefined) => ReactNode;
  nameFormatter?: (
    name: TooltipPayloadEntry["name"],
    entry: TooltipPayloadEntry,
  ) => ReactNode;
  payload?: TooltipPayload;
  valueFormatter?: (
    value: TooltipValueType | undefined,
    entry: TooltipPayloadEntry,
  ) => ReactNode;
}

function defaultValueFormatter(value: TooltipValueType | undefined) {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return value?.join(" - ") ?? "";
}

export function ChartTooltipContent({
  active,
  hideLabel = false,
  label,
  labelFormatter,
  nameFormatter,
  payload,
  valueFormatter,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const formattedLabel = labelFormatter ? labelFormatter(label) : label;

  return (
    <div className="min-w-32 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {!hideLabel &&
        formattedLabel !== undefined &&
        formattedLabel !== null && (
          <p className="font-medium">{formattedLabel}</p>
        )}
      <div className={hideLabel ? "space-y-1" : "mt-1.5 space-y-1"}>
        {payload.map((entry, index) => {
          const color =
            typeof entry.color === "string"
              ? entry.color
              : typeof entry.fill === "string"
                ? entry.fill
                : undefined;
          const formattedName = nameFormatter
            ? nameFormatter(entry.name, entry)
            : entry.name;
          const formattedValue = valueFormatter
            ? valueFormatter(entry.value, entry)
            : defaultValueFormatter(entry.value);

          return (
            <div
              key={`${String(entry.dataKey ?? entry.name ?? "item")}-${index}`}
              className="flex items-center gap-2"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted-foreground">{formattedName}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums">
                {formattedValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
