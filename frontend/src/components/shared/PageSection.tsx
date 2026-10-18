import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled block on a page: small uppercase heading ("WAITING FOR YOU · 1")
 * above its content. Used to stack sections on single-column pages such as
 * Friends and Identity links.
 */
export function PageSection({
  title,
  count,
  children,
  className,
  ...props
}: {
  title: ReactNode;
  /** Shown as " · N" after the title when given. */
  count?: number;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("space-y-3", className)} {...props}>
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
        {count !== undefined && (
          <span className="tabular-nums"> · {count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}
