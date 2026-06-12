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
import { useFlowUnions } from "@/hooks/useFlowUnions";
import { useIsMobile } from "@/hooks/useMobile";
import { memberPairKey } from "@/utils/graphUtils";
import { useMemberLocator } from "@/hooks/useMemberLocator";
import { useConnectionMode } from "@/hooks/useConnectionMode";
import { useRelationCreation } from "@/hooks/useRelationCreation";
import { usePendingMember } from "@/hooks/usePendingMember";

const nodeTypes = { familyMember: FamilyNode, unionNode: UnionNode };
const edgeTypes = { relation: RelationEdge };

export const FlowPanel = () => {
  const activeTree = useTreeStore((s) => s.selectedTree);
  const isMobile = useIsMobile();
  const { members, removeMember, updateLayout } = useMemberStore();
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
    viewport,
    setViewport,
  } = useFamilyTreeSettings();
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

  // --- Unions & node positions ---
  const unions = useFlowUnions(members);

  // Use `nodes` (local state, updates on every drag frame) rather than `members`
  // (store, lags by the debounce) so union dots track their parents in real-time.
  const nodePositions = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.position])),
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
              // Center the dot at the mid-height of the partner cards so the
              // horizontal connector edges are level with the card handles.
              y: (p1.y + p2.y) / 2 + NODE_HEIGHT / 2 - UNION_NODE_SIZE / 2,
            },
            data: {
              ...u,
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
  );
  const viewEdges = useFlowEdges(
    members,
    unions,
    visibleRelationTypes,
    edgeType,
    connection.connectionPath.edgeKeys,
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

  // Virtual views: the viewport is a global setting (not per-tree), so after a
  // virtual view loads we must fit the view regardless of where the camera was.
  // The ref prevents re-fitting on every drag (nodes change) — once per view id.
  const fittedViewRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isReady || !rfInstance || !isVirtualView || !activeTree) return;
    if (nodes.length === 0) return;
    if (fittedViewRef.current === activeTree.id) return;
    fittedViewRef.current = activeTree.id;
    requestAnimationFrame(() => rfInstance.fitView({ padding: 0.2 }));
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
    updateLayout().then(() => rfInstance?.fitView());
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

  if (!isReady || !activeTree) return null;

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={[...viewNodes, ...unionNodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
        nodesFocusable={connection.isConnectionMode || !isCanvasReadOnly}
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
        onMoveEnd={(_, viewport) => setViewport(viewport)}
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
          <CanvasSearch
            members={members}
            onLocate={locator.locateMember}
            className={isMobile ? "w-full" : undefined}
          />
        </Panel>
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
