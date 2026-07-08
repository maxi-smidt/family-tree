import { useStore } from "@xyflow/react";

// Vertical spacing between ruled lines, in flow (canvas) coordinates. 250 is
// five 50px grid cells and roughly one generation's row pitch (NODE_HEIGHT 145
// + RANK_SEPARATION 90 ≈ 235), so the ruled bands read like notebook lines that
// line up with the generations for orientation.
export const GENERATION_LINE_GAP = 250;

type Transform = [number, number, number];

const transformSelector = (s: { transform: Transform }): Transform =>
  s.transform;

export interface RuledLinePattern {
  scaledGap: number;
  offsetY: number;
}

// Pure geometry helper (exported for testing): from the current viewport
// transform [x, y, zoom] and the flow-space gap, return the on-screen line
// spacing and the vertical offset so the lines track vertical panning. Mirrors
// how React Flow's own <Background> derives its pattern from the transform.
export function getRuledLinePattern(
  transform: Transform,
  gap: number,
): RuledLinePattern {
  const zoom = transform[2];
  const scaledGap = gap * zoom || 1;
  const offsetY = transform[1] % scaledGap;
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
  const { scaledGap, offsetY } = getRuledLinePattern(transform, gap);

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
