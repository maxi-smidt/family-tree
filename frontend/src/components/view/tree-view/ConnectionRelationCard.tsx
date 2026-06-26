import { ArrowLeft, ArrowRight } from "lucide-react";
import { ConnectionRelation } from "@/hooks/useConnectionMode";

interface ConnectionRelationCardProps {
  relation: ConnectionRelation;
}

/** A rounded name "chip" sitting at either end of the relation arrows. */
function NameChip({ name }: { name: string }) {
  return (
    <span className="max-w-[8rem] truncate rounded-full border bg-muted px-3 py-1.5 text-sm font-medium">
      {name}
    </span>
  );
}

/**
 * One arrow with a centred relation label. `direction` controls which end the
 * arrowhead sits on (and therefore who the relation points at).
 */
function RelationArrow({
  label,
  direction,
}: {
  label: string;
  direction: "right" | "left";
}) {
  const line = <div className="h-px flex-1 bg-current" />;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[11px] font-medium leading-tight text-foreground">
        {label}
      </span>
      <div className="flex w-full items-center text-foreground/50">
        {direction === "left" && <ArrowLeft className="h-3.5 w-3.5 shrink-0" />}
        {line}
        {direction === "right" && (
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </div>
    </div>
  );
}

/**
 * Renders a connected pair of members as two name chips with two opposing,
 * individually-labelled arrows:
 *
 *            grandmother
 *   [Anna]  ───────────▶  [Carl]
 *           ◀───────────
 *            grandson
 */
export function ConnectionRelationCard({
  relation,
}: ConnectionRelationCardProps) {
  const { aName, bName, aToBLabel, bToALabel } = relation;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-md">
      <NameChip name={aName} />
      <div className="flex min-w-[7rem] flex-1 flex-col gap-1.5">
        {aToBLabel && <RelationArrow label={aToBLabel} direction="right" />}
        {bToALabel && <RelationArrow label={bToALabel} direction="left" />}
      </div>
      <NameChip name={bName} />
    </div>
  );
}
