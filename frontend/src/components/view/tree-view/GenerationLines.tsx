import { useStore } from "@xyflow/react";
import { NODE_HEIGHT } from "@/constants";

// Vertical spacing between ruled lines, in flow (canvas) coordinates. 500 is ten
// 50px grid cells — roughly two generations' row pitch (NODE_HEIGHT 145 +
// RANK_SEPARATION 90 ≈ 235 each) — so the ruled bands read like notebook lines
// for orientation. Because the gap is a multiple of the 50px snap grid, a node
// placed at a multiple of the gap lands its vertical center exactly on a line
// (see the NODE_HEIGHT/2 phase applied below).
export const GENERATION_LINE_GAP = 500;

type Transform = [number, number, number];

const transformSelector = (s: { transform: Transform }): Transform =>
  s.transform;

export interface RuledLinePattern {
  scaledGap: number;
  offsetY: number;
}

// Pure geometry helper (exported for testing): from the current viewport
// transform [x, y, zoom], the flow-space gap, and a flow-space vertical phase,
// return the on-screen line spacing and the pattern's vertical offset so the
// lines track panning and are shifted by `phase`. Mirrors how React Flow's own
// <Background> derives its pattern from the transform. The phase lets the lines
// sit on node centers instead of node tops (phase = NODE_HEIGHT / 2).
export function getRuledLinePattern(
  transform: Transform,
  gap: number,
  phase = 0,
): RuledLinePattern {
  const zoom = transform[2];
  const scaledGap = gap * zoom || 1;
  const offsetY = (transform[1] + phase * zoom) % scaledGap;
  return { scaledGap, offsetY };
}

interface GenerationLinesProps {
  visible: boolean;
  gap?: number;
}

// Fixed horizontal ruled lines rendered as a repeating SVG pattern behind the
// nodes. Unlike React Flow's Lines background (a full grid) this draws only the
// horizontal rules. It intentionally does NOT use the `.react-flow__background`
// class, which paints an opaque background-color that would cover the canvas;
// only the positioning styles are replicated so the pattern is transparent and
// sits behind the nodes alongside the existing dot background.
export default function GenerationLines({
  visible,
  gap = GENERATION_LINE_GAP,
}: GenerationLinesProps) {
  const transform = useStore(transformSelector);
  // Phase the lines by half a card so a node's vertical center — not its top —
  // can land on a line when placed at a multiple of the gap.
  const { scaledGap, offsetY } = getRuledLinePattern(
    transform,
    gap,
    NODE_HEIGHT / 2,
  );

  if (!visible) return null;

  const patternId = "ft-generation-lines";

  return (
    <svg
      aria-hidden="true"
      className="text-muted-foreground/30"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: -1,
      }}
    >
      <pattern
        id={patternId}
        x={0}
        y={offsetY}
        width={scaledGap}
        height={scaledGap}
        patternUnits="userSpaceOnUse"
      >
        <line
          x1={0}
          y1={0}
          x2={scaledGap}
          y2={0}
          stroke="currentColor"
          strokeWidth={1}
        />
      </pattern>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill={`url(#${patternId})`}
      />
    </svg>
  );
}
