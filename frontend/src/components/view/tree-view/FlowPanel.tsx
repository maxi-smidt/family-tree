import {
  Background,
  ConnectionMode,
  Edge,
  Node,
  Panel,
  Position,
  ReactFlow,
  ReactFlowInstance,
  SelectionMode,
} from "@xyflow/react";
import { RemoveMemberDialog } from "@/components/shared/dialog/RemoveMemberDialog";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { Member } from "@/types/member";
import { NODE_WIDTH, NODE_HEIGHT } from "@/constants";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore, isVirtualId } from "@/hooks/useTreeStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FlowPanelControls } from "@/components/view/tree-view/FlowPanelControls";
import GenerationLines from "@/components/view/tree-view/GenerationLines";
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
import { useSelectionMode } from "@/hooks/useSelectionMode";
import { SelectionModeController } from "@/components/view/tree-view/SelectionModeController";
import { useRelationCreation } from "@/hooks/useRelationCreation";
import { usePendingMember } from "@/hooks/usePendingMember";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTaskStore } from "@/hooks/useTaskStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { NoDatabasePlaceholder } from "@/components/layout/NoDatabasePlaceholder";
import { PresenceChips } from "@/components/layout/PresenceChips";
import {
  clearMemberSheetDeepLink,
  readMemberSheetDeepLink,
} from "@/utils/memberSheetState";
import { getGenerationLineGap } from "@/utils/generationLineSpacing";

const nodeTypes = { familyMember: FamilyNode, unionNode: UnionNode };
const edgeTypes = { relation: RelationEdge };

interface FlowPanelProps {
  // Chromeless, purely-visual rendering for the public read-only tree view:
  // no member sheet, no edit dialogs, no node action buttons.
  publicView?: boolean;
}

// Stable reference for "no connection-path highlight". findConnectionPathHighlight
// returns a fresh (often empty) Set on every members change; passing that straight
// into useFlowEdges would re-derive viewEdges from a still-stale baseEdges during the
// async worker round-trip, briefly re-adding a just-deleted edge (a one-frame flicker).
// An empty highlight set has no visual effect, so we collapse it to one shared instance.
const EMPTY_EDGE_KEYS: ReadonlySet<string> = new Set<string>();

export const FlowPanel = ({ publicView = false }: FlowPanelProps = {}) => {
  const { t } = useTranslation();
  const taskRestrictions = useTreeStore((s) => s.selectedTree?.restrictions);
  const tasksEnabled = !taskRestrictions?.includes("tasks");
  const { refreshTasks, initialized: tasksInitialized } = useTaskStore();
  // Open-task node indicators need the task list; skip on public trees where
  // the task endpoints require authentication.
  useDeferredStoreLoad(
    tasksInitialized || !tasksEnabled || publicView,
    refreshTasks,
  );
  const activeTree = useTreeStore((s) => s.selectedTree);
  const openTreeAndLocateMember = useTreeStore(
    (s) => s.openTreeAndLocateMember,
  );
  const savedMemberSheetState = useMemberSheetStore((s) =>
    activeTree?.id ? s.openSheets[activeTree.id] : undefined,
  );
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);
  const clearOpenSheet = useMemberSheetStore((s) => s.clearOpenSheet);
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
    pendingLocateMemberId,
    setPendingLocateMemberId,
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
    generationLineGaps,
  } = useFamilyTreeSettings();
  // Locking the canvas also disables per-node edit affordances (pencil,
  // quick-add, connect handles) and the member sheet's edit toggle, on top of
  // the role/mobile read-only gating. Drag/select/connect are gated
  // separately at the ReactFlow level below.
  const isEditReadOnly = isCanvasReadOnly || isLockedScreen;
  const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
  const viewport = (activeTree && viewports[activeTree.id]) ?? DEFAULT_VIEWPORT;
  const generationLineGap = getGenerationLineGap(
    activeTree ? generationLineGaps[activeTree.id] : undefined,
  );
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);

  // --- Extracted hooks ---
  const locator = useMemberLocator(members, rfInstance);

  // Center the counterpart after navigating into a linked tree: consume the
  // one-shot locate request once the member shows up in the loaded set. In
  // windowed mode the counterpart may lie outside the current neighborhood —
  // re-focus the window on it once and locate after the reload.
  const attemptedLinkedFocusRef = useRef<string | null>(null);
  const consumedLocateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingLocateMemberId) {
      consumedLocateRef.current = null;
      return;
    }
    const target = members.find((m) => m.id === pendingLocateMemberId);
    if (target) {
      // Wait until the canvas is fully up before consuming the request: on a
      // fresh mount (e.g. arriving from the map view) rfInstance is null,
      // the nodes land a couple of commits later, and React Flow applies its
      // initial viewport only once it is measured — centering before that
      // gets silently overridden. viewportInitialized flips after that
      // initial viewport is in; the `nodes` dep re-runs this until then.
      if (!rfInstance?.viewportInitialized || !rfInstance.getNode(target.id))
        return;
      // Commits queued behind the mount burst still carry the pre-consumption
      // store snapshot — don't re-center for each of them.
      if (consumedLocateRef.current === pendingLocateMemberId) return;
      consumedLocateRef.current = pendingLocateMemberId;
      attemptedLinkedFocusRef.current = null;
      setPendingLocateMemberId(null);
      locator.locateMember(target);
      return;
    }
    if (members.length === 0) return; // still loading
    if (windowed && attemptedLinkedFocusRef.current !== pendingLocateMemberId) {
      attemptedLinkedFocusRef.current = pendingLocateMemberId;
      void setFocusRoot(pendingLocateMemberId);
      return;
    }
    // Fully loaded (or window already re-focused) and still absent: the
    // counterpart no longer exists — drop the request.
    attemptedLinkedFocusRef.current = null;
    setPendingLocateMemberId(null);
  }, [
    pendingLocateMemberId,
    members,
    windowed,
    setFocusRoot,
    setPendingLocateMemberId,
    locator,
    rfInstance,
    nodes,
  ]);

  // Mutual exclusion between connection mode and selection mode: entering one
  // exits the other. `connection` is instantiated first, so its
  // onEnterConnectionMode callback can't close over `selection` directly
  // (TDZ / stale closure). Instead it reads the latest selection-mode state
  // and toggle function through a ref that is kept up to date every render.
  const exitSelectionRef = useRef<{
    isSelectionMode: boolean;
    toggleSelectionMode: () => void;
  } | null>(null);

  const connection = useConnectionMode(members, () => {
    setSelectedNodes([]);
    if (exitSelectionRef.current?.isSelectionMode) {
      exitSelectionRef.current.toggleSelectionMode();
    }
  });

  const selection = useSelectionMode(() => {
    if (connection.isConnectionMode) connection.toggleConnectionMode();
  });

  useEffect(() => {
    exitSelectionRef.current = selection;
  });

  // Clear the marquee selection when selection mode is exited (native RF
  // selection + our selectedNodes mirror). Skip the initial mount so this
  // doesn't run before the user has ever entered selection mode.
  const prevIsSelectionModeRef = useRef(false);
  useEffect(() => {
    if (prevIsSelectionModeRef.current && !selection.isSelectionMode) {
      setSelectedNodes([]);
      setNodes((ns) =>
        ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
      );
    }
    prevIsSelectionModeRef.current = selection.isSelectionMode;
  }, [selection.isSelectionMode]);

  const inSelectionMode = selection.isSelectionMode;

  const relation = useRelationCreation();

  const pending = usePendingMember({
    onHorizontalRelationReady: relation.startHorizontalRelation,
  });
  const memberSheetDeepLink = useMemo(readMemberSheetDeepLink, []);
  const consumedMemberSheetDeepLinkRef = useRef(false);
  const attemptedMemberSheetRestoreRef = useRef<string | null>(null);

  useEffect(() => {
    const deepLinkState = consumedMemberSheetDeepLinkRef.current
      ? undefined
      : memberSheetDeepLink;
    const requestedState = deepLinkState ?? savedMemberSheetState;
    const treeId = activeTree?.id;
    if (publicView || !requestedState || !treeId || pending.editingMemberId) {
      return;
    }

    const savedMember = members.find(
      (member) => member.id === requestedState.memberId,
    );
    if (savedMember) {
      attemptedMemberSheetRestoreRef.current = null;
      setOpenSheet(treeId, requestedState);
      if (deepLinkState) {
        consumedMemberSheetDeepLinkRef.current = true;
        clearMemberSheetDeepLink();
      }
      pending.setEditingMemberId(savedMember.id);
      pending.setIsEditMode(requestedState.mode === "edit");
    } else if (
      isReady &&
      windowed &&
      attemptedMemberSheetRestoreRef.current !== requestedState.memberId
    ) {
      attemptedMemberSheetRestoreRef.current = requestedState.memberId;
      void setFocusRoot(requestedState.memberId);
    } else if (isReady) {
      clearOpenSheet(treeId);
      if (deepLinkState) {
        consumedMemberSheetDeepLinkRef.current = true;
        clearMemberSheetDeepLink();
      }
    }
  }, [
    activeTree?.id,
    clearOpenSheet,
    isReady,
    memberSheetDeepLink,
    members,
    pending.editingMemberId,
    pending.setEditingMemberId,
    pending.setIsEditMode,
    publicView,
    savedMemberSheetState,
    setOpenSheet,
    setFocusRoot,
    windowed,
  ]);

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
            // Hide the union dot when a partner is collapsed away, so it does
            // not linger with dangling connector edges.
            hidden:
              hiddenNodeIds.has(u.partner1Id) ||
              hiddenNodeIds.has(u.partner2Id),
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
              onAddChildToUnion: pending.onAddChildToUnion,
              isReadOnly: isEditReadOnly,
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
      hiddenNodeIds,
      pending.onAddChildToUnion,
      isEditReadOnly,
    ],
  );

  const openLinkedTree = useTreeStore((s) => s.openLinkedTree);
  const allTrees = useTreeStore((s) => s.trees);
  // Tree ids the user has listed access to (own + shared) — used to mute
  // linked-tree badges pointing at trees not shared with them. In the public
  // view there is no tree list, so accessibility is unknown (undefined).
  const accessibleTreeIds = useMemo(
    () =>
      publicView || allTrees.length === 0
        ? undefined
        : new Set(allTrees.map((tr) => tr.id)),
    [publicView, allTrees],
  );
  const handleOpenLinkedTree = useMemo(
    () => (treeId: string, memberId?: string | null) => {
      void openLinkedTree(treeId, memberId).catch(() => {
        toast.error(t("tree-view.linked-tree.open-error"));
      });
    },
    [openLinkedTree, t],
  );

  // Collapsed ancestors hide their descendant member nodes (handled in
  // useFlowNodes) and the union dots between them (above). Edges touching any
  // hidden member/union must also be hidden, otherwise React Flow keeps drawing
  // floating lines. Union ids are hidden when either partner is hidden.
  const hiddenElementIds = useMemo(() => {
    const ids = new Set<string>(hiddenNodeIds);
    for (const u of unions) {
      if (hiddenNodeIds.has(u.partner1Id) || hiddenNodeIds.has(u.partner2Id)) {
        ids.add(u.id);
      }
    }
    return ids;
  }, [hiddenNodeIds, unions]);

  const viewNodes = useFlowNodes(
    nodes,
    pending.setEditingMemberId,
    pending.setIsEditMode,
    pending.onAddChild,
    pending.onAddParent,
    (id) => pending.onAddHorizontal(id, "left"),
    (id) => pending.onAddHorizontal(id, "right"),
    locator.highlightedNodeId,
    isEditReadOnly,
    connection.connectionSelectedIds,
    connection.connectionPath.nodeIds,
    connection.isConnectionMode,
    connection.hasConnectionPath,
    hiddenNodeIds,
    handleOpenLinkedTree,
    publicView,
    accessibleTreeIds,
    selection.isSelectionMode,
  );
  const viewEdges = useFlowEdges(
    baseEdges,
    connection.connectionPath.edgeKeys.size > 0
      ? connection.connectionPath.edgeKeys
      : EMPTY_EDGE_KEYS,
    hiddenElementIds,
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
        className={`ft-tree-canvas${inSelectionMode ? " cursor-crosshair" : ""}`}
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
          isCanvasReadOnly || connection.isConnectionMode || inSelectionMode
            ? undefined
            : onEdgesChange
        }
        onConnect={
          isCanvasReadOnly || connection.isConnectionMode || inSelectionMode
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
          !connection.isConnectionMode &&
          !isLockedScreen &&
          !isCanvasReadOnly &&
          !inSelectionMode
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
        connectOnClick={
          !connection.isConnectionMode && !isCanvasReadOnly && !inSelectionMode
        }
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        selectionOnDrag={inSelectionMode}
        panOnDrag={inSelectionMode ? [1, 2] : undefined}
        selectionMode={inSelectionMode ? SelectionMode.Partial : undefined}
        // In selection mode every click toggles a member (see
        // SelectionModeController); disabling the modifier key stops the
        // built-in handler from turning multi-selection back off.
        multiSelectionKeyCode={inSelectionMode ? null : undefined}
        // With multi-selection forced on, selecting on drag-start would toggle
        // (deselect) the node you grab to move; select on click instead so
        // dragging a selected member keeps the selection intact.
        selectNodesOnDrag={inSelectionMode ? false : undefined}
        onInit={setRfInstance}
        defaultViewport={viewport}
        onMoveEnd={(_, vp) => activeTree && setViewport(activeTree.id, vp)}
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": t("tree-view.controls.zoom-in"),
          "controls.zoomOut.ariaLabel": t("tree-view.controls.zoom-out"),
          "controls.fitView.ariaLabel": t("tree-view.controls.fit-view"),
        }}
      >
        <SelectionModeController active={inSelectionMode} />
        <Background />
        {/* pr-16 clears the notification bell fixed at top-4 right-4 in Layout. */}
        <Panel position="top-right" className="pt-2 pr-16">
          <PresenceChips />
        </Panel>
        <GenerationLines
          visible={generationLineGap !== null}
          gap={generationLineGap ?? undefined}
        />
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
              onOpenOtherTree={openTreeAndLocateMember}
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
        {inSelectionMode && (
          <Panel position="top-center" className="!top-2">
            <div className="flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1.5 text-xs shadow-md">
              <span>
                {t("tree-view.selection.selected-count", {
                  count: selectedNodes.length,
                })}
              </span>
              <span className="text-muted-foreground">
                {t("tree-view.selection.hint")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-0.5 text-xs"
                onClick={() => {
                  setSelectedNodes([]);
                  setNodes((ns) =>
                    ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
                  );
                }}
              >
                {t("tree-view.selection.clear")}
              </Button>
            </div>
          </Panel>
        )}
        <Panel position="bottom-left" className="pb-2 flex flex-col gap-2">
          <FlowPanelControls
            navigationOnly={isCanvasReadOnly}
            isConnectionMode={connection.isConnectionMode}
            connectionDisabled={members.length < 2}
            onToggleConnectionMode={connection.toggleConnectionMode}
            isSelectionMode={selection.isSelectionMode}
            onToggleSelectionMode={selection.toggleSelectionMode}
            selectionAvailable={!isCanvasReadOnly}
            selectionDisabled={members.length < 1 || isLockedScreen}
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
      {/* The public read-only view is purely visual: no detail sheet or edit
          dialogs are mounted. */}
      {!publicView && (
        <>
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
            canEdit={!isEditReadOnly}
            isNewMember={pending.isNewMemberSession}
            onDiscardNewMember={pending.discardNewMember}
            onSaveNewMember={pending.saveNewMember}
          />
          <AddRelationDialog
            isOpen={relation.isDialogOpen}
            onClose={relation.closeDialog}
            onConfirm={relation.confirmRelation}
          />
        </>
      )}
    </div>
  );

  function initializeFlow() {
    // Rebuilt on every `members` change (incl. drag-position persistence), so
    // carry the current selection over — otherwise moving a selected member
    // would clear the selection once its new position is saved.
    setNodes((prevNodes) => {
      const selectedIds = new Set(
        prevNodes.filter((n) => n.selected).map((n) => n.id),
      );
      return members.map((member) => ({
        id: member.id,
        type: "familyMember",
        position: member.position,
        data: member,
        selected: selectedIds.has(member.id),
      }));
    });
  }
};
