import { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToolbarButtonProps = Omit<
  ComponentProps<typeof Button>,
  "variant" | "size"
> & {
  /** Toggle state: renders a soft primary fill and sets aria-pressed. */
  active?: boolean;
};

/**
 * Borderless round icon button for the canvas toolbar. The bar itself is a
 * pill, so every button is a circle that only shows a fill on hover or when
 * toggled on, instead of carrying its own border.
 */
export const ToolbarButton = ({
  active,
  className,
  ...props
}: ToolbarButtonProps) => (
  <Button
    variant="ghost"
    size="icon"
    aria-pressed={active}
    className={cn(
      "rounded-full text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent",
      active &&
        "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary dark:hover:bg-primary-soft",
      className,
    )}
    {...props}
  />
);

/** A run of related toolbar buttons, sitting flush next to each other. */
export const ToolbarGroup = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <div
    role="group"
    className={cn("flex items-center gap-0.5", className)}
    {...props}
  />
);

/** Short vertical rule between toolbar groups. */
export const ToolbarSeparator = () => (
  <div
    role="separator"
    aria-orientation="vertical"
    className="mx-1 h-5 w-px shrink-0 bg-border"
  />
);
