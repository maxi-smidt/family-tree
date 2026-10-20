import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  PREVIEW_CHILD_LINKS,
  PREVIEW_COUPLES,
  PREVIEW_FOCUS_ID,
  PREVIEW_NODES,
  PreviewNode,
} from "@/utils/treePreview";

const UNIT_X = 34;
const UNIT_Y = 30;
const RADIUS = 7;
const PAD = 14;

const minX = Math.min(...PREVIEW_NODES.map((n) => n.x));
const maxX = Math.max(...PREVIEW_NODES.map((n) => n.x));
const maxGen = Math.max(...PREVIEW_NODES.map((n) => n.generation));
const minGen = Math.min(...PREVIEW_NODES.map((n) => n.generation));
const WIDTH = (maxX - minX) * UNIT_X + PAD * 2;
const HEIGHT = (maxGen - minGen) * UNIT_Y + PAD * 2;

const byId = new Map(PREVIEW_NODES.map((n) => [n.id, n]));
const px = (n: PreviewNode) => (n.x - minX) * UNIT_X + PAD;
const py = (n: PreviewNode) => (maxGen - n.generation) * UNIT_Y + PAD;
const node = (id: string) => byId.get(id)!;
const personCount = PREVIEW_NODES.filter((n) => n.kind === "person").length;

interface TreePreviewProps {
  /** Dummy node ids the current settings include (see `utils/treePreview`). */
  included: ReadonlySet<string>;
  /** Dummy nodes outside the chosen sections — drawn dashed. */
  outside?: ReadonlySet<string>;
  /** Connected context that is not a member of the new section. */
  boundary?: ReadonlySet<string>;
  /** "view" labels the highlighted node as the focus person, "section" as
   *  the seed person. */
  variant: "view" | "section";
  className?: string;
}

/** A miniature, schematic family tree (never real data) that shades which
 *  parts of a tree a view or section would take in. */
export const TreePreview = ({
  included,
  outside,
  boundary,
  variant,
  className,
}: TreePreviewProps) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-preview" });
  const on = (id: string) => included.has(id);
  const lineClass = (active: boolean) =>
    active ? "stroke-primary" : "stroke-muted-foreground/25";
  const includedCount = PREVIEW_NODES.filter(
    (n) => n.kind === "person" && on(n.id),
  ).length;
  const focusLabel = variant === "view" ? t("focus") : t("seed");

  return (
    <figure
      className={cn("rounded-md border bg-muted/30 px-3 pt-2 pb-2", className)}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mx-auto block h-auto w-full max-w-[260px]"
        role="img"
        aria-label={t("summary", {
          included: includedCount,
          total: personCount,
        })}
      >
        <g fill="none" strokeWidth={1.5}>
          {PREVIEW_CHILD_LINKS.map(({ child, parents }) => {
            const c = node(child);
            const ps = parents.map(node);
            const fromX = ps.reduce((sum, p) => sum + px(p), 0) / ps.length;
            const fromY = py(ps[0]);
            const midY = (fromY + py(c)) / 2;
            const active = on(child) && parents.some(on);
            return (
              <path
                key={`link-${child}`}
                d={`M${fromX},${fromY} V${midY} H${px(c)} V${py(c)}`}
                className={lineClass(active)}
              />
            );
          })}
          {PREVIEW_COUPLES.map(({ a, b }) => (
            <line
              key={`couple-${a}-${b}`}
              x1={px(node(a))}
              y1={py(node(a))}
              x2={px(node(b))}
              y2={py(node(b))}
              className={lineClass(on(a) && on(b))}
            />
          ))}
        </g>
        {PREVIEW_NODES.map((n) => {
          const x = px(n);
          const y = py(n);
          const active = on(n.id);
          const isBoundary = !!boundary?.has(n.id);
          const dashed = !!outside?.has(n.id);
          if (n.kind === "more") {
            return (
              <g key={n.id} data-included={active}>
                {[-7, 0, 7].map((dx) => (
                  <circle
                    key={dx}
                    cx={x + dx}
                    cy={y}
                    r={2}
                    className={
                      active ? "fill-primary" : "fill-muted-foreground/30"
                    }
                  />
                ))}
              </g>
            );
          }
          const isFocus = n.id === PREVIEW_FOCUS_ID;
          return (
            <g key={n.id} data-included={active} data-boundary={isBoundary}>
              {!dashed && (
                <circle cx={x} cy={y} r={RADIUS} className="fill-background" />
              )}
              {isFocus && (
                <circle
                  cx={x}
                  cy={y}
                  r={RADIUS + 3.5}
                  className="fill-none stroke-primary"
                  strokeWidth={2}
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={RADIUS}
                strokeWidth={1.5}
                strokeDasharray={dashed || isBoundary ? "2.5 2" : undefined}
                className={cn(
                  "transition-colors",
                  isFocus
                    ? "fill-primary stroke-primary"
                    : active
                      ? "fill-primary/70 stroke-primary"
                      : isBoundary
                        ? "fill-background stroke-primary/60"
                        : dashed
                          ? "fill-none stroke-muted-foreground/40"
                          : "fill-background stroke-muted-foreground/35",
                )}
              />
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <LegendItem
          label={focusLabel}
          ring
          className="fill-primary stroke-primary"
        />
        <LegendItem
          label={t("included")}
          className="fill-primary/70 stroke-primary"
        />
        <LegendItem
          label={t("excluded")}
          className="fill-background stroke-muted-foreground/35"
        />
        {boundary && boundary.size > 0 && (
          <LegendItem
            label={t("boundary")}
            dashed
            className="fill-background stroke-primary/60"
          />
        )}
        {outside && outside.size > 0 && (
          <LegendItem
            label={t("outside-sections")}
            dashed
            className="fill-none stroke-muted-foreground/40"
          />
        )}
        <span className="w-full text-center text-[10px] opacity-80">
          {t("caption")}
        </span>
      </figcaption>
    </figure>
  );
};

const LegendItem = ({
  label,
  className,
  ring,
  dashed,
}: {
  label: string;
  className: string;
  ring?: boolean;
  dashed?: boolean;
}) => (
  <span className="inline-flex items-center gap-1">
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
      {ring && (
        <circle
          cx={8}
          cy={8}
          r={7}
          className="fill-none stroke-primary"
          strokeWidth={1.5}
        />
      )}
      <circle
        cx={8}
        cy={8}
        r={ring ? 4.5 : 5.5}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "2 1.6" : undefined}
        className={className}
      />
    </svg>
    {label}
  </span>
);
