import { MiniMap, Node, useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { MouseEvent } from "react";
import type { Member } from "@/types/member";

/** Person cards take their gender's accent; union knots are left out. */
export const minimapNodeColor = (node: Node): string => {
  if (node.type !== "familyMember") return "transparent";
  switch ((node.data as Partial<Member>).gender) {
    case "m":
      return "var(--gender-m)";
    case "f":
      return "var(--gender-f)";
    default:
      return "var(--gender-o)";
  }
};

/**
 * Overview of the whole canvas in the bottom-right corner. The shaded mask
 * leaves the visible part clear; drag it (or scroll over the map) to move
 * around, or click anywhere on the map to jump there.
 */
export const TreeMinimap = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.controls",
  });
  const reactFlow = useReactFlow();

  const jumpTo = (_: MouseEvent, position: { x: number; y: number }) => {
    void reactFlow.setCenter(position.x, position.y, {
      zoom: reactFlow.getZoom(),
      duration: 300,
    });
  };

  return (
    <MiniMap
      className="ft-tree-minimap"
      position="bottom-right"
      pannable
      zoomable
      ariaLabel={t("minimap")}
      nodeColor={minimapNodeColor}
      nodeStrokeWidth={0}
      nodeBorderRadius={12}
      onClick={jumpTo}
    />
  );
};
