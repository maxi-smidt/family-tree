import { useState } from "react";
import { useReactFlow, getNodesBounds } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useTreeStore } from "@/hooks/useTreeStore";

const EXPORT_PADDING_PX = 40;
const EXPORT_PIXEL_RATIO = 2;
const EXPORT_MAX_DIM = 4000;

// Presentation attributes that CSS classes can set on SVG elements but that
// html-to-image does NOT inline (it deep-clones SVG subtrees without processing
// their children). Pre-inlining them ensures the export canvas renders strokes
// and fills even after the page stylesheet is no longer available.
const SVG_INLINE_PROPS = [
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "fill",
  "fill-opacity",
  "opacity",
  "marker-end",
  "marker-start",
] as const;

function inlineSvgStyles(container: HTMLElement): () => void {
  const elements = Array.from(container.querySelectorAll<SVGElement>("svg *"));
  const saved = elements.map((el) => {
    const oldStyle = el.getAttribute("style") ?? "";
    const computed = window.getComputedStyle(el);
    SVG_INLINE_PROPS.forEach((prop) => {
      const value = computed.getPropertyValue(prop);
      if (value) el.style.setProperty(prop, value);
    });
    return { el, oldStyle };
  });

  return () => {
    saved.forEach(({ el, oldStyle }) => {
      if (oldStyle) {
        el.setAttribute("style", oldStyle);
      } else {
        el.removeAttribute("style");
      }
    });
  };
}

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

    const rawWidth = bounds.width + EXPORT_PADDING_PX * 2;
    const rawHeight = bounds.height + EXPORT_PADDING_PX * 2;
    const dimScale = Math.min(1, EXPORT_MAX_DIM / Math.max(rawWidth, rawHeight));
    const imageWidth = Math.round(rawWidth * dimScale);
    const imageHeight = Math.round(rawHeight * dimScale);

    const tx = (-bounds.x + EXPORT_PADDING_PX) * dimScale;
    const ty = (-bounds.y + EXPORT_PADDING_PX) * dimScale;

    const backgroundColor = window.getComputedStyle(document.body).backgroundColor;

    // Pre-inline SVG presentation styles — html-to-image clones SVG subtrees
    // with cloneNode(true) but skips style decoration on SVG children, so
    // CSS-class-driven stroke/fill would be lost in the canvas render.
    const restoreSvgStyles = inlineSvgStyles(viewport);

    setIsExporting(true);
    try {
      const dataUrl = await toPng(viewport, {
        width: imageWidth,
        height: imageHeight,
        pixelRatio: EXPORT_PIXEL_RATIO,
        backgroundColor,
        filter: (node) => {
          if (node instanceof Element) {
            // Drop the background dot grid — it tiles relative to the live viewport
            // transform and would appear misaligned with our export transform.
            if (
              node instanceof SVGElement &&
              node.classList.contains("react-flow__background")
            )
              return false;
            // Drop elements explicitly tagged as export-only chrome (fast-mode buttons).
            if (node.hasAttribute("data-export-hide")) return false;
          }
          return true;
        },
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
      restoreSvgStyles();
      setIsExporting(false);
    }
  }

  return { exportImage, isExporting };
}
