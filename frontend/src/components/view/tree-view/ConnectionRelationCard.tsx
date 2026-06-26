import { ConnectionRelation } from "@/hooks/useConnectionMode";

interface ConnectionRelationCardProps {
  relation: ConnectionRelation;
  /** Centre the canvas on the clicked member. */
  onLocate: (memberId: string) => void;
}

/**
 * A rounded, clickable name "chip" at either end of the relation arrows.
 * Clicking pans/zooms the canvas onto that member.
 */
function NameChip({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className="pointer-events-auto max-w-[8rem] cursor-pointer truncate rounded-full border bg-muted px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {name}
    </button>
  );
}

/**
 * One uninterrupted horizontal line with a CSS-triangle arrowhead and a
 * relation label placed above or below it. The line and head share the same
 * colour and meet flush, so the arrow reads as a single straight stroke.
 */
function RelationArrow({
  label,
  direction,
  labelPosition,
}: {
  label: string;
  direction: "right" | "left";
  labelPosition: "above" | "below";
}) {
  const text = (
    <span className="text-[11px] font-medium leading-tight text-foreground">
      {label}
    </span>
  );
  return (
    <div className="flex flex-col items-center gap-0.5">
      {labelPosition === "above" && text}
      <div className="flex w-full items-center text-foreground/60">
        {direction === "left" && (
          <span className="h-0 w-0 shrink-0 border-y-[3px] border-r-[6px] border-y-transparent border-r-current" />
        )}
        <div className="h-px flex-1 bg-current" />
        {direction === "right" && (
          <span className="h-0 w-0 shrink-0 border-y-[3px] border-l-[6px] border-y-transparent border-l-current" />
        )}
      </div>
      {labelPosition === "below" && text}
    </div>
  );
}

/**
 * Renders a connected pair of members as two clickable name chips with two
 * opposing, individually-labelled arrows. Each arrow points at the person it
 * describes:
 *
 *            grandmother
 *   [Anna]  ───────────▶  [Carl]
 *           ◀───────────
 *            grandson
 */
export function ConnectionRelationCard({
  relation,
  onLocate,
}: ConnectionRelationCardProps) {
  const { aId, bId, aName, bName, aToBLabel, bToALabel } = relation;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-md">
      <NameChip name={aName} onClick={() => onLocate(aId)} />
      <div className="flex min-w-[7rem] flex-1 flex-col gap-1">
        {aToBLabel && (
          <RelationArrow
            label={aToBLabel}
            direction="right"
            labelPosition="above"
          />
        )}
        {bToALabel && (
          <RelationArrow
            label={bToALabel}
            direction="left"
            labelPosition="below"
          />
        )}
      </div>
      <NameChip name={bName} onClick={() => onLocate(bId)} />
    </div>
  );
}
