import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { UnionInfo } from "@/hooks/useFlowUnions";
import { useTranslation } from "react-i18next";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";

export const UNION_NODE_SIZE = 10;

type UnionNodeData = UnionInfo & {
  isConnectionPath?: boolean;
  isConnectionDimmed?: boolean;
  isReadOnly?: boolean;
  onAddChildToUnion?: (parent1Id: string, parent2Id: string) => void;
};

export const UnionNode = ({ data }: NodeProps<Node<UnionNodeData>>) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.node" });
  const { t: tRoot } = useTranslation();
  const { isFastMode } = useFamilyTreeSettings();
  const isConnectionPath = data.isConnectionPath === true;
  const isConnectionDimmed = data.isConnectionDimmed === true;
  // Colour is resolved upstream (relation-type default merged with the admin
  // override) and threaded through node data; fall back to the neutral default.
  const color = data.color ?? "var(--muted-foreground)";

  const unionLabel = data.relationType
    ? t("union-type", {
        type: tRoot(`common.relation-types.${data.relationType}`),
      })
    : undefined;

  return (
    <div
      role={unionLabel ? "img" : undefined}
      aria-label={unionLabel}
      title={unionLabel}
      style={{
        position: "relative",
        width: UNION_NODE_SIZE,
        height: UNION_NODE_SIZE,
        borderRadius: "50%",
        backgroundColor: isConnectionPath ? "hsl(45 93% 47%)" : color,
        boxShadow: isConnectionPath ? "0 0 0 4px hsl(45 93% 47% / 0.22)" : "",
        opacity: isConnectionDimmed ? 0.25 : 1,
        transition: "background-color 0.2s, box-shadow 0.2s, opacity 0.2s",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ opacity: 0 }}
      />
      {isFastMode && !data.isReadOnly && (
        <Button
          variant="ghost"
          aria-label={t("add-child")}
          data-export-hide="true"
          className="nodrag nopan absolute left-1/2 -translate-x-1/2 top-3 w-6 h-6 rounded-full p-0 bg-muted-foreground hover:bg-muted-foreground/80 z-10"
          onClick={() =>
            data.onAddChildToUnion?.(data.partner1Id, data.partner2Id)
          }
        >
          <PlusIcon className="text-card" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
};
