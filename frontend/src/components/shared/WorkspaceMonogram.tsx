import { cn } from "@/lib/utils";

type MonogramSize = "sm" | "md" | "lg";

const SIZES: Record<MonogramSize, string> = {
  sm: "size-6 rounded-md text-xs",
  md: "size-9 rounded-[10px] text-[17px]",
  lg: "size-11 rounded-xl text-xl",
};

/** First letter of a workspace name on a tile — the workspace's "logo". */
export function WorkspaceMonogram({
  name,
  size = "md",
  muted = false,
  className,
}: {
  name: string | null | undefined;
  size?: MonogramSize;
  /** Soft tint instead of the solid accent (for lists of many). */
  muted?: boolean;
  className?: string;
}) {
  const letter = Array.from(name?.trim() ?? "")[0]?.toLocaleUpperCase() || "·";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center font-bold",
        SIZES[size],
        muted
          ? "bg-primary-soft text-primary"
          : "bg-primary text-primary-foreground",
        className,
      )}
    >
      {letter}
    </span>
  );
}
