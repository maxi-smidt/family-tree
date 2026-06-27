import {
  Background,
  ConnectionMode,
  Edge,
  Node,
  Panel,
  Position,
  ReactFlow,
  ReactFlowInstance,
} from "@xyflow/react";
import { RemoveMemberDialog } from "@/components/shared/dialog/RemoveMemberDialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Member } from "@/types/member";
import { NODE_WIDTH, NODE_HEIGHT } from "@/constants";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore, isVirtualId } from "@/hooks/useTreeStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FlowPanelControls } from "@/components/view/tree-view/FlowPanelControls";
import { CanvasSearch } from "@/components/view/tree-view/CanvasSearch";
import { EmptyTreeState } from "@/components/view/tree-view/EmptyTreeState";
import { MemberControls } from "@/components/view/tree-view/MemberControls";
import { ConnectionRelationCard } from "@/components/view/tree-view/ConnectionRelationCard";
import { MemberSheet } from "@/components/shared/member-sheet/MemberSheet";
import { FamilyNode } from "@/components/view/tree-view/node/FamilyNode";
import {
  UnionNode,
  UNION_NODE_SIZE,
} from "@/components/view/tree-view/node/UnionNode";
import { AddRelationDialog } from "@/components/view/tree-view/dialog/AddRelationDialog";
import { RelationEdge } from "@/components/view/tree-view/edge/RelationEdge";
import { useFlowNodes } from "@/hooks/useFlowNodes";
import { useFlowEdges } from "@/hooks/useFlowEdges";
import { useFlowInteractions } from "@/hooks/useFlowInteractions";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useDerivedFlowView } from "@/hooks/useDerivedFlowView";
import { useIsMobile } from "@/hooks/useMobile";
import { memberPairKey } from "@/utils/graphUtils";
import {
  resolveRelationStyle,
  relationStyleOverrideFromType,
} from "@/utils/relationStyleUtils";
import { fitViewToAllNodes } from "@/utils/flowFit";
import { useMemberLocator } from "@/hooks/useMemberLocator";
import { useConnectionMode } from "@/hooks/useConnectionMode";
import { useRelationCreation } from "@/hooks/useRelationCreation";
import { usePendingMember } from "@/hooks/usePendingMember";
import { useTranslation } from "react-i18next";
import { NoDatabasePlaceholder } from "@/components/layout/NoDatabasePlaceholder";

const nodeTypes = { familyMember: FamilyNode, unionNode: UnionNode };
const edgeTypes = { relation: RelationEdge };

// Stable reference for "no connection-path highlight". findConnectionPathHighlight
// returns a fresh (often empty) Set on every members change; passing that straight
// into useFlowEdges would re-derive viewEdges from a still-stale baseEdges during the
// async worker round-trip, briefly re-adding a just-deleted edge (a one-frame flicker).
// An empty highlight set has no visual effect, so we collapse it to one shared instance.
const EMPTY_EDGE_KEYS: ReadonlySet<string> = new Set<string>();

export const FlowPanel = () => {
  const { t } = useTranslation();
  const activeTree = useTreeStore((s) => s.selectedTree);
  const availableTreeCount = useTreeStore(
    (s) => s.trees.length + s.virtualViews.length,
  );
  const isMobile = useIsMobile();
  const {
    members,
    removeMember,
    updateLayout,
    windowed,
    focusRootId,
    neighborhoodTruncated,
    totalMemberCount,
    setFocusRoot,
  } = useMemberStore();
  const canWrite = activeTree?.role !== "viewer";
  const isVirtualView = !!activeTree?.id && isVirtualId(activeTree.id);
  const isCanvasReadOnly = isMobile || !canWrite;
  // Virtual views allow dragging even though canWrite is false (role: "viewer").
  // Positions are persisted independently in VirtualViewPosition.
  const canDragLayout = !isMobile && (canWrite || isVirtualView);
  useUndoRedo(!isCanvasReadOnly);
  const { isReady } = useTreeStore();

  const {
    edgeType,
    isLockedScreen,
    visibleRelationTypes,
    viewports,
    setViewport,
  } = useFamilyTreeSettings();
  const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
  const viewport = (activeTree && viewports[activeTree.id]) ?? DEFAULT_VIEWPORT;
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);

  // --- Extracted hooks ---
  const locator = useMemberLocator(members, rfInstance);

  const connection = useConnectionMode(members, () => setSelectedNodes([]));

  const relation = useRelationCreation();

  const pending = usePendingMember({
    onHorizontalRelationReady: relation.startHorizontalRelation,
  });

  // --- Unions, edges & visibility — computed off the main thread ---
  const { unions, baseEdges, hiddenNodeIds } = useDerivedFlowView(
    members,
    visibleRelationTypes,
    edgeType,
  );

  // Resolve each union dot's colour the same way edges are styled: the
  // relation-type default merged with the admin override. Without this the
  // dot ignores configured colours (the edges are styled in the worker).
  const relationTypes = useTreeStore((s) => s.relationTypes);
  const resolveUnionColor = useMemo(() => {
    const byId = new Map(relationTypes.map((rt) => [rt.id, rt]));
    return (relationType?: string): string => {
      const rt = relationType ? byId.get(relationType) : undefined;
      return resolveRelationStyle(
        relationType ?? "",
        rt ? relationStyleOverrideFromType(rt) : undefined,
      ).stroke;
    };
  }, [relationTypes]);

  // Use `nodes` (local state, updates on every drag frame) rather than `members`
  // (store, lags by the debounce) so union dots track their parents in real-time.
  // Carry the measured height: card height varies with content (e.g. source-tree
  // badges in virtual views), and the side handles sit at the measured mid-height.
  const nodePositions = useMemo(
    () =>
      new Map(
        nodes.map((n) => [
          n.id,
          {
            x: n.position.x,
            y: n.position.y,
            height: n.measured?.height ?? NODE_HEIGHT,
          },
        ]),
      ),
    [nodes],
  );

  const unionNodes = useMemo<Node[]>(
    () =>
      unions
        .filter(
          (u) =>
            nodePositions.has(u.partner1Id) && nodePositions.has(u.partner2Id),
        )
        .map((u) => {
          const p1 = nodePositions.get(u.partner1Id)!;
          const p2 = nodePositions.get(u.partner2Id)!;
          const unionMemberPairHighlighted =
            connection.connectionPath.edgeKeys.has(
              memberPairKey(u.partner1Id, u.partner2Id),
            );
          const unionChildHighlighted = u.childIds.some((childId) =>
            [u.partner1Id, u.partner2Id].some((parentId) =>
              connection.connectionPath.edgeKeys.has(
                memberPairKey(parentId, childId),
              ),
            ),
          );
          const isUnionConnectionPath =
            connection.hasConnectionPath &&
            (unionMemberPairHighlighted || unionChildHighlighted);

          return {
            id: u.id,
            type: "unionNode",
            position: {
              x: (p1.x + p2.x) / 2 + NODE_WIDTH / 2 - UNION_NODE_SIZE / 2,
              // Center the dot at the average mid-height of the partner cards
              // (where their side handles sit) so the connector edges run level.
              y:
                (p1.y + p1.height / 2 + p2.y + p2.height / 2) / 2 -
                UNION_NODE_SIZE / 2,
            },
            data: {
              ...u,
              color: resolveUnionColor(u.relationType),
              isConnectionPath: isUnionConnectionPath,
              isConnectionDimmed:
                connection.isConnectionMode &&
                connection.hasConnectionPath &&
                !isUnionConnectionPath,
            },
            draggable: false,
            selectable: false,
            focusable: false,
            // Pre-set dimensions so React Flow skips its ResizeObserver
            // measurement cycle and renders the node visible immediately.
            width: UNION_NODE_SIZE,
            height: UNION_NODE_SIZE,
            // Pre-declare handles so React Flow's isNodeInitialized()
            // returns true without waiting for DOM-based handle measurement.
            // Without this, getEdgePosition() returns null and edges are invisible.
            handles: [
              {
                id: "left",
                type: "target" as const,
                position: Position.Left,
                x: 0,
                y: 0,
                width: 1,
                height: UNION_NODE_SIZE,
              },
              {
                id: "right",
                type: "source" as const,
                position: Position.Right,
                x: 0,
                y: 0,
                width: UNION_NODE_SIZE,
                height: UNION_NODE_SIZE,
              },
              {
                id: "bottom",
                type: "source" as const,
                position: Position.Bottom,
                x: 0,
                y: 0,
                width: UNION_NODE_SIZE,
                height: UNION_NODE_SIZE,
              },
            ],
          };
        }),
    [
      unions,
      nodePositions,
      resolveUnionColor,
      connection.connectionPath.edgeKeys,
      connection.hasConnectionPath,
      connection.isConnectionMode,
    ],
  );

  const viewNodes = useFlowNodes(
    nodes,
    pending.setEditingMemberId,
    pending.setIsEditMode,
    pending.onAddChild,
    pending.onAddParent,
    (id) => pending.onAddHorizontal(id, "left"),
    (id) => pending.onAddHorizontal(id, "right"),
    locator.highlightedNodeId,
    isCanvasReadOnly,
    connection.connectionSelectedIds,
    connection.connectionPath.nodeIds,
    connection.isConnectionMode,
    connection.hasConnectionPath,
    hiddenNodeIds,
  );
  const viewEdges = useFlowEdges(
    baseEdges,
    connection.connectionPath.edgeKeys.size > 0
      ? connection.connectionPath.edgeKeys
      : EMPTY_EDGE_KEYS,
  );

  const {
    onNodesChange,
    onEdgesChange,
    onConnect,
    onSelectionChange,
    debouncedSave,
    pendingUpdates,
  } = useFlowInteractions(
    members,
    edges,
    unions,
    setNodes,
    setEdges,
    setMembersToDelete,
    setSelectedNodes,
    relation.setNewRelation,
  );

  useEffect(() => {
    setEdges(viewEdges);
  }, [viewEdges]);

  useEffect(() => {
    if (!isReady) return;
    initializeFlow();
  }, [members, isReady]);

  // Re-center when the focus root changes in windowed mode.
  const prevFocusRootRef = useRef<string | null>(null);
  useEffect(() => {
    if (!windowed || !rfInstance) return;
    if (focusRootId === prevFocusRootRef.current) return;
    prevFocusRootRef.current = focusRootId;
    requestAnimationFrame(() => fitViewToAllNodes(rfInstance, 0.2));
  }, [windowed, focusRootId, rfInstance]);

  // Virtual views: the viewport is a global setting (not per-tree), so after a
  // virtual view loads we must fit the view regardless of where the camera was.
  // The ref prevents re-fitting on every drag (nodes change) — once per view id.
  const fittedViewRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isReady || !rfInstance || !isVirtualView || !activeTree) return;
    if (nodes.length === 0) return;
    if (fittedViewRef.current === activeTree.id) return;
    fittedViewRef.current = activeTree.id;
    requestAnimationFrame(() => fitViewToAllNodes(rfInstance, 0.2));
  }, [isReady, rfInstance, isVirtualView, activeTree, nodes]);

  useEffect(() => {
    setSelectedNodes((prevSelected) => {
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      return prevSelected
        .map((node) => nodeMap.get(node.id))
        .filter((n) => n !== undefined);
    });
  }, [nodes]);

  const rearrangeNodes = () => {
    debouncedSave.cancel();
    pendingUpdates.current = {};
    updateLayout().then(() => {
      if (rfInstance) fitViewToAllNodes(rfInstance);
    });
  };

  const handleAddFirstMember = () => {
    if (!rfInstance) return;
    const flowPoint = rfInstance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    pending.addFirstMember({
      x: flowPoint.x - NODE_WIDTH / 2,
      y: flowPoint.y,
    });
  };

  const confirmDelete = () => {
    membersToDelete.forEach((member) => {
      void removeMember(member.id);
    });
    setNodes((currentNodes) =>
      currentNodes.filter(
        (node) => !membersToDelete.some((m) => m.id === node.id),
      ),
    );
    setMembersToDelete([]);
  };

  if (!activeTree) {
    return availableTreeCount === 0 ? <NoDatabasePlaceholder /> : null;
  }

  if (!isReady) return null;

  return (
    <div className="w-full h-full" aria-label={t("tree-view.canvas-label")}>
      <ReactFlow
        nodes={[...viewNodes, ...unionNodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onlyRenderVisibleElements
        onNodesChange={
          (!canDragLayout && isCanvasReadOnly) || connection.isConnectionMode
            ? undefined
            : onNodesChange
        }
        onEdgesChange={
          isCanvasReadOnly || connection.isConnectionMode
            ? undefined
            : onEdgesChange
        }
        onConnect={
          isCanvasReadOnly || connection.isConnectionMode
            ? undefined
            : onConnect
        }
        defaultEdgeOptions={{ type: edgeType }}
        onSelectionChange={
          isCanvasReadOnly || connection.isConnectionMode
            ? undefined
            : onSelectionChange
        }
        onNodeClick={connection.handleNodeClick}
        minZoom={0.1}
        snapToGrid={true}
        snapGrid={[50, 50]}
        nodesDraggable={
          !connection.isConnectionMode && !isLockedScreen && canDragLayout
        }
        nodesConnectable={
          !connection.isConnectionMode && !isLockedScreen && !isCanvasReadOnly
        }
        elementsSelectable={
          connection.isConnectionMode || (!isLockedScreen && !isCanvasReadOnly)
        }
        nodesFocusable={true}
        autoPanOnNodeFocus={true}
        disableKeyboardA11y={false}
        edgesFocusable={!connection.isConnectionMode && !isCanvasReadOnly}
        deleteKeyCode={
          isCanvasReadOnly || connection.isConnectionMode
            ? null
            : ["Backspace", "Delete"]
        }
        connectOnClick={!connection.isConnectionMode && !isCanvasReadOnly}
        connectionMode={ConnectionMode.Loose}
        onInit={setRfInstance}
        defaultViewport={viewport}
        onMoveEnd={(_, vp) => activeTree && setViewport(activeTree.id, vp)}
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": t("tree-view.controls.zoom-in"),
          "controls.zoomOut.ariaLabel": t("tree-view.controls.zoom-out"),
          "controls.fitView.ariaLabel": t("tree-view.controls.fit-view"),
        }}
      >
        <Background />
        {members.length === 0 && !isCanvasReadOnly && (
          <Panel
            position="top-center"
            className="!left-1/2 !-translate-x-1/2 !top-1/2 !-translate-y-1/2"
          >
            <EmptyTreeState onAddFirstMember={handleAddFirstMember} />
          </Panel>
        )}
        <Panel
          position={isMobile ? "top-center" : "top-left"}
          className={isMobile ? "w-[calc(100vw-1rem)] pt-2" : "pt-2"}
        >
          <div className="flex flex-col gap-1">
            <CanvasSearch
              members={members}
              onLocate={locator.locateMember}
              className={isMobile ? "w-full" : undefined}
              windowed={windowed}
              treeId={activeTree?.id}
              onFocusRoot={setFocusRoot}
            />
            {windowed && neighborhoodTruncated && (
              <div className="rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md">
                {t("tree-view.windowed.banner", {
                  count: members.length,
                  total: totalMemberCount,
                })}
              </div>
            )}
          </div>
        </Panel>
        {connection.isConnectionMode &&
          connection.connectionRelations.length > 0 && (
            <Panel position="top-center" className="!top-2 pointer-events-none">
              {/* Cap the stack at ~3 cards; scroll the rest so many selected
                  members don't overflow the canvas. */}
              <div className="pointer-events-auto flex max-h-[15rem] flex-col gap-2 overflow-y-auto px-1 py-1">
                {connection.connectionRelations.map((rel) => (
                  <ConnectionRelationCard
                    key={`${rel.aId}|${rel.bId}`}
                    relation={rel}
                    onLocate={(id) => {
                      const target = members.find((m) => m.id === id);
                      if (target) locator.locateMember(target);
                    }}
                  />
                ))}
              </div>
            </Panel>
          )}
        <Panel position="bottom-left" className="pb-2 flex flex-col gap-2">
          <FlowPanelControls
            navigationOnly={isCanvasReadOnly}
            isConnectionMode={connection.isConnectionMode}
            connectionDisabled={members.length < 2}
            onToggleConnectionMode={connection.toggleConnectionMode}
          />
        </Panel>
        {(!isCanvasReadOnly || isVirtualView) && (
          <Panel position="bottom-right" className="pb-2">
            <MemberControls
              nodes={nodes}
              selectedNodes={selectedNodes}
              setMembersToDelete={setMembersToDelete}
              onEditMember={(member) => pending.editExisting(member)}
              onCreateNewMember={(member) => pending.createNew(member)}
              onRearrange={rearrangeNodes}
              readOnly={isVirtualView}
            />
          </Panel>
        )}
      </ReactFlow>
      <RemoveMemberDialog
        isOpen={!!membersToDelete.length}
        members={membersToDelete}
        onConfirm={confirmDelete}
        onCancel={() => setMembersToDelete([])}
      />
      <MemberSheet
        isOpen={!!pending.editingMember}
        onClose={pending.closeSheet}
        member={pending.editingMember}
        initialEditMode={pending.isEditMode}
        canEdit={!isMobile && canWrite}
        isNewMember={pending.isNewMemberSession}
        onDiscardNewMember={pending.discardNewMember}
        onSaveNewMember={pending.saveNewMember}
      />
      <AddRelationDialog
        isOpen={relation.isDialogOpen}
        onClose={relation.closeDialog}
        onConfirm={relation.confirmRelation}
      />
    </div>
  );

  function initializeFlow() {
    const newNodes = members.map((member) => ({
      id: member.id,
      type: "familyMember",
      position: member.position,
      data: member,
    }));
    setNodes(newNodes);
  }
};
