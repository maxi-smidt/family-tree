import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-[color,box-shadow] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
        // Pill-shaped filter chip (e.g. Everyone / Living / Deceased). Use in
        // a ToggleGroup with spacing so each chip keeps its own rounding.
        // Multi-select filter pill (e.g. map location types): on reads as a
        // normal card pill, off fades to a dashed outline.
        filter:
          "rounded-full border border-input bg-card px-3 text-foreground hover:bg-accent data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:hover:bg-accent data-[state=off]:border-dashed data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground data-[state=off]:[&>span:first-child]:opacity-40",
        chip: "rounded-full border border-border bg-card px-3 text-muted-foreground hover:border-input hover:bg-card hover:text-foreground data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background",
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
