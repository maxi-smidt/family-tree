import { useState } from "react";
import { useReactFlow, getNodesBounds } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useTreeStore } from "@/hooks/useTreeStore";

const EXPORT_PADDING_PX = 40;
const EXPORT_PIXEL_RATIO = 2;
// Max canvas dimension (before pixel ratio) to keep file sizes reasonable on huge trees.
const EXPORT_MAX_DIM = 4000;

export function useTreeExport() {
  const [isExporting, setIsExporting] = useState(false);
  const { getNodes } = useReactFlow();
  const treeName = useTreeStore((s) => s.selectedTree?.name);

  async function exportImage() {
    const nodes = getNodes();
    if (nodes.length === 0) return;

    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) return;

    const bounds = getNodesBounds(nodes);

    // Target 1:1 zoom (nodes at their natural CSS pixel size) with padding.
    // Scale the whole thing down proportionally if the tree is very large.
    const rawWidth = bounds.width + EXPORT_PADDING_PX * 2;
    const rawHeight = bounds.height + EXPORT_PADDING_PX * 2;
    const dimScale = Math.min(1, EXPORT_MAX_DIM / Math.max(rawWidth, rawHeight));
    const imageWidth = Math.round(rawWidth * dimScale);
    const imageHeight = Math.round(rawHeight * dimScale);

    // Build the viewport transform that maps every node into the export canvas.
    // At dimScale=1: leftmost node appears at x=PADDING, topmost at y=PADDING.
    const tx = (-bounds.x + EXPORT_PADDING_PX) * dimScale;
    const ty = (-bounds.y + EXPORT_PADDING_PX) * dimScale;

    const backgroundColor = window.getComputedStyle(document.body).backgroundColor;

    setIsExporting(true);
    try {
      const dataUrl = await toPng(viewport, {
        width: imageWidth,
        height: imageHeight,
        pixelRatio: EXPORT_PIXEL_RATIO,
        backgroundColor,
        // The background SVG tiles relative to the current viewport transform and
        // would render misaligned when we apply a custom transform; remove it so
        // the solid backgroundColor shows through instead.
        filter: (node) =>
          !(
            node instanceof SVGElement &&
            node.classList?.contains("react-flow__background")
          ),
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${tx}px, ${ty}px) scale(${dimScale})`,
          transformOrigin: "top left",
        },
      });

      const a = document.createElement("a");
      a.setAttribute("download", `${treeName ?? "family-tree"}.png`);
      a.setAttribute("href", dataUrl);
      a.click();
    } finally {
      setIsExporting(false);
    }
  }

  return { exportImage, isExporting };
}
