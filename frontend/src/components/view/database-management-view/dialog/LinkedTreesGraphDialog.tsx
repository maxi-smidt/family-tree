import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { TreeService } from "@/services/TreeService";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { TREE_VIEW } from "@/lib/tabs";
import { LinkGraphEdgeDB, LinkGraphNodeDB } from "@/types/linkGraph";
import { Tree } from "@/types/tree";
import { toast } from "sonner";
import {
  LINK_GRAPH_NODE_HEIGHT,
  LINK_GRAPH_NODE_WIDTH,
  layoutLinkGraph,
  LinkGraphPoint,
} from "@/utils/linkGraphLayout";
import { Network } from "lucide-react";

type Props = {
  tree: Tree | null;
  onClose: () => void;
};

interface LinkGraphNodeData extends LinkGraphNodeDB, Record<string, unknown> {
  onOpen?: (treeId: string) => void;
}

interface LinkGraphEdgeData extends Record<string, unknown> {
  bridgeNames: string[];
  /** Dagre's routing waypoints — the path bends around intermediate nodes. */
  points: LinkGraphPoint[];
}

/** A smooth path through dagre's waypoints (quadratic curves through segment midpoints). */
function smoothPath(points: LinkGraphPoint[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x},${points[i].y} ${midX},${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

function LinkGraphNodeCard({ data }: NodeProps<Node<LinkGraphNodeData>>) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.linked-trees-graph",
  });
  const clickable = data.accessible && !data.is_current;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => clickable && data.onOpen?.(data.id)}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          data.onOpen?.(data.id);
        }
      }}
      className={`flex flex-col gap-1 rounded-lg border p-3 h-full justify-center bg-card ${
        data.is_current ? "border-primary border-2 shadow-md" : "border-border"
      } ${!data.accessible ? "border-dashed opacity-60" : ""} ${
        clickable ? "cursor-pointer hover:border-primary/60" : ""
      }`}
      style={{ width: LINK_GRAPH_NODE_WIDTH, height: LINK_GRAPH_NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <Handle type="source" position={Position.Right} className="opacity-0" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium text-sm truncate">
          {data.accessible ? data.name : t("no-access-node")}
        </span>
      </div>
      {data.accessible ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {data.is_current && (
            <Badge variant="default" className="text-xs">
              {t("current-tree-badge")}
            </Badge>
          )}
          {data.role === "owner" ? (
            <Badge variant="secondary" className="text-xs">
              {t("role-own-badge")}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              {t("role-shared-badge")}
            </Badge>
          )}
          {typeof data.member_count === "number" && (
            <span className="text-xs text-muted-foreground">
              {t("member-count", { count: data.member_count })}
            </span>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("no-access-hint")}
        </span>
      )}
    </div>
  );
}

function LinkGraphEdgeLine({
  id,
  markerEnd,
  label,
  data,
}: EdgeProps<Edge<LinkGraphEdgeData>>) {
  const points = data?.points ?? [];
  if (points.length < 2) return null;

  const edgePath = smoothPath(points);
  const mid = points[Math.floor(points.length / 2)];
  const labelX = mid.x;
  const labelY = mid.y;
  const title = (data?.bridgeNames ?? []).join(", ");

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      >
        {title && <title>{title}</title>}
      </path>
      {label !== undefined && label !== null && (
        <EdgeLabelRenderer>
          <div
            title={title}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium border border-border"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { linkGraphTree: LinkGraphNodeCard };
const edgeTypes = { linkGraphEdge: LinkGraphEdgeLine };

export const LinkedTreesGraphDialog = ({ tree, onClose }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.linked-trees-graph",
  });
  const openLinkedTree = useTreeStore((s) => s.openLinkedTree);
  const navigateTo = useNavigationStore((s) => s.navigateTo);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [graphNodes, setGraphNodes] = useState<LinkGraphNodeDB[]>([]);
  const [graphEdges, setGraphEdges] = useState<LinkGraphEdgeDB[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!tree) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    TreeService.getLinkGraph(tree.id)
      .then((res) => {
        if (cancelled) return;
        setGraphNodes(res.nodes);
        setGraphEdges(res.edges);
        setTruncated(res.truncated);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tree]);

  const handleOpen = async (treeId: string) => {
    try {
      await openLinkedTree(treeId);
      onClose();
      navigateTo(TREE_VIEW);
    } catch {
      toast.error(t("open-error"));
    }
  };

  const { flowNodes, flowEdges } = useMemo(() => {
    const rfNodes: Node<LinkGraphNodeData>[] = graphNodes.map((n) => ({
      id: n.id,
      type: "linkGraphTree",
      position: { x: 0, y: 0 },
      data: { ...n, onOpen: handleOpen },
      draggable: false,
    }));
    // A mutual pair (A→B plus B→A) is one bridge connection seen from both
    // sides — draw it as a single undirected line. Only genuinely one-way
    // links keep an arrowhead, which includes links into inaccessible
    // placeholder trees (their back-links are unknowable).
    const byPair = new Map(
      graphEdges.map((e) => [`${e.source_tree_id}|${e.target_tree_id}`, e]),
    );
    const merged: { edge: LinkGraphEdgeDB; bidirectional: boolean }[] = [];
    const consumed = new Set<string>();
    for (const e of graphEdges) {
      const key = `${e.source_tree_id}|${e.target_tree_id}`;
      if (consumed.has(key)) continue;
      consumed.add(key);
      const reverse = byPair.get(`${e.target_tree_id}|${e.source_tree_id}`);
      if (!reverse) {
        merged.push({ edge: e, bidirectional: false });
        continue;
      }
      consumed.add(`${e.target_tree_id}|${e.source_tree_id}`);
      merged.push({
        edge: {
          ...e,
          // Each fully linked bridge pair contributes one link per direction.
          count: Math.max(e.count, reverse.count),
          bridge_members: [...e.bridge_members, ...reverse.bridge_members],
        },
        bidirectional: true,
      });
    }

    const rfEdges: Edge<LinkGraphEdgeData>[] = merged.map(
      ({ edge: e, bidirectional }) => ({
        id: `${e.source_tree_id}->${e.target_tree_id}`,
        source: e.source_tree_id,
        target: e.target_tree_id,
        type: "linkGraphEdge",
        label: e.count > 1 ? String(e.count) : undefined,
        markerEnd: bidirectional
          ? undefined
          : { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        data: {
          bridgeNames: [
            ...new Set(
              e.bridge_members
                .map((m) => m.name)
                .filter((n): n is string => !!n),
            ),
          ],
          points: [],
        },
      }),
    );
    const { nodes: laidOut, edgePoints } = layoutLinkGraph(rfNodes, rfEdges);
    const routedEdges = rfEdges.map((e) => ({
      ...e,
      data: { ...e.data!, points: edgePoints.get(e.id) ?? [] },
    }));
    return { flowNodes: laidOut, flowEdges: routedEdges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges]);

  const isEmpty = !loading && !error && graphNodes.length <= 1;

  return (
    <Dialog open={!!tree} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description", { name: tree?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-[400px] rounded-lg border overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="size-6" />
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {t("load-error")}
            </div>
          )}
          {!loading && !error && isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {t("empty-state")}
            </div>
          )}
          {!loading && !error && !isEmpty && (
            <div className="absolute inset-0">
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background />
              </ReactFlow>
            </div>
          )}
        </div>
        {truncated && (
          <p className="text-xs text-muted-foreground">{t("truncated-hint")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
};
