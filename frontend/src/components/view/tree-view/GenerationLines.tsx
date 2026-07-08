import { useMemo } from "react";
import { Node, ViewportPortal } from "@xyflow/react";
import { NODE_WIDTH, NODE_HEIGHT } from "@/constants";

const PADDING = 80;

export interface GenerationLines {
  lineYs: number[];
  xStart: number;
  xEnd: number;
}

export function getGenerationLines(
  nodes: { position: { x: number; y: number } }[],
): GenerationLines | null {
  if (nodes.length === 0) return null;

  const distinctYs = Array.from(new Set(nodes.map((n) => n.position.y))).sort(
    (a, b) => a - b,
  );
  const lineYs = distinctYs.map((y) => y + NODE_HEIGHT / 2);

  const xs = nodes.map((n) => n.position.x);
  const xStart = Math.min(...xs) - PADDING;
  const xEnd = Math.max(...xs) + NODE_WIDTH + PADDING;

  return { lineYs, xStart, xEnd };
}

interface GenerationLinesProps {
  nodes: Node[];
  visible: boolean;
}

export default function GenerationLines({
  nodes,
  visible,
}: GenerationLinesProps) {
  const lines = useMemo(() => getGenerationLines(nodes), [nodes]);

  if (!visible || !lines) return null;

  const { lineYs, xStart, xEnd } = lines;

  return (
    <ViewportPortal>
      <svg
        aria-hidden="true"
        className="text-muted-foreground/25"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          overflow: "visible",
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        {lineYs.map((y) => (
          <line
            key={y}
            x1={xStart}
            x2={xEnd}
            y1={y}
            y2={y}
            stroke="currentColor"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}
