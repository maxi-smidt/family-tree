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
import { canEditArea } from "@/utils/accessLevels";
import { RemoveMemberDialog } from "@/components/shared/dialog/RemoveMemberDialog";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { Member, createMember } from "@/types/member";
import { Maximize, UserPlus } from "lucide-react";
import { NODE_WIDTH, NODE_HEIGHT } from "@/constants";
import { SNAP_GRID } from "@/utils/gridUtils";
import { EXPANSION_NODE_BUDGET, useMemberStore } from "@/hooks/useMemberStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import {
  CanvasMenuItems,
  FlowPanelControls,
} from "@/components/view/tree-view/FlowPanelControls";
import { ToolbarSeparator } from "@/components/view/tree-view/CanvasToolbar";
import GenerationLines from "@/components/view/tree-view/GenerationLines";
import { CanvasSearch } from "@/components/view/tree-view/CanvasSearch";
import { ContinuationControls } from "@/components/view/tree-view/ContinuationControls";
import { useCanvasHistory } from "@/hooks/useCanvasHistory";
import { WorkspaceNavigationPanel } from "@/components/view/tree-view/nav/WorkspaceNavigationPanel";
import { EmptyTreeState } from "@/components/view/tree-view/EmptyTreeState";
import { MemberControls } from "@/components/view/tree-view/MemberControls";
import { ConnectionRelationCard } from "@/components/view/tree-view/ConnectionRelationCard";
import { MemberSheet } from "@/components/shared/member-sheet/MemberSheet";
import { MemberPeekCard } from "@/components/view/tree-view/MemberPeekCard";
import { DatabaseSelector } from "@/components/sidebar/DatabaseSelector";
import { FamilyNode } from "@/components/view/tree-view/node/FamilyNode";
import {
  UnionNode,
  UNION_NODE_SIZE,
} from "@/components/view/tree-view/node/UnionNode";
import { AddRelationDialog } from "@/components/view/tree-view/dialog/AddRelationDialog";
import { NewMemberSectionPrompt } from "@/components/view/tree-view/nav/NewMemberSectionPrompt";
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
import { useTaskStore } from "@/hooks/useTaskStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { NoDatabasePlaceholder } from "@/components/layout/NoDatabasePlaceholder";
import { PresenceChips } from "@/components/layout/PresenceChips";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  clearMemberSheetDeepLink,
  readMemberSheetDeepLink,
} from "@/utils/memberSheetState";
import { getGenerationLineGap } from "@/utils/generationLineSpacing";
import { buildMemberNodes } from "@/utils/memberNodes";

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
  const taskRestrictions = useWorkspaceStore(
    (s) => s.selectedTree?.restrictions,
  );
  const tasksEnabled = !taskRestrictions?.includes("tasks");
  const { refreshTasks, initialized: tasksInitialized } = useTaskStore();
  // Open-task node indicators need the task list; skip on public workspaces where
  // the task endpoints require authentication.
  useDeferredStoreLoad(
    tasksInitialized || !tasksEnabled || publicView,
    refreshTasks,
  );
  const activeTree = useWorkspaceStore((s) => s.selectedTree);
  const openTreeAndLocateMember = useWorkspaceStore(
    (s) => s.openTreeAndLocateMember,
  );
  const savedMemberSheetState = useMemberSheetStore((s) =>
    activeTree?.id ? s.openSheets[activeTree.id] : undefined,
  );
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);
  const clearOpenSheet = useMemberSheetStore((s) => s.clearOpenSheet);
  const availableTreeCount = useWorkspaceStore((s) => s.workspaces.length);
  const isMobile = useIsMobile();
  const {
    members,
    removeMember,
    updateLayout,
    windowed,
    focusRootId,
    focusSectionIds,
    focusPending,
    activeSavedViewId,
    neighborhoodTruncated,
    neighborhoodExpandable,
    totalMemberCount,
    setFocusRoot,
    pendingLocateMemberId,
    setPendingLocateMemberId,
    continuations,
    neighborhoodCursor,
    neighborhoodUp,
    neighborhoodDown,
    expandGeneration,
    loadMoreNeighborhood,
    resetNeighborhood,
  } = useMemberStore();
  const canWrite = canEditArea(activeTree, "tree");
  const isCanvasReadOnly = isMobile || !canWrite;
  const canDragLayout = !isMobile && canWrite;
  useUndoRedo(!isCanvasReadOnly);
  const { isReady } = useWorkspaceStore();

  const {
    edgeType,
    isLockedScreen,
    visibleRelationTypes,
    viewports,
    setViewport,
    generationLineGaps,
  } = useFamilyTreeSettings();
  const savedRelationTypes = useMemberStore(
    (s) => s.savedViewFilters.visibleRelationTypes,
  );
  const effectiveRelationTypes = useMemo(
    () =>
      Array.isArray(savedRelationTypes)
        ? savedRelationTypes.filter(
            (value): value is string => typeof value === "string",
          )
        : visibleRelationTypes,
    [savedRelationTypes, visibleRelationTypes],
  );
  // Locking the canvas also disables per-node edit affordances (pencil,
  // quick-add, connect handles) and the member sheet's edit toggle, on top of
  // the role/mobile read-only gating. Drag/select/connect are gated
  // separately at the ReactFlow level below.
  const isEditReadOnly = isCanvasReadOnly || isLockedScreen;
  // Phones can't drag or connect on the canvas, but they can still open a
  // person and edit or add relatives through the sheet.
  const canEditMembers = canWrite && !isLockedScreen;
  const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
  const viewport = (activeTree && viewports[activeTree.id]) ?? DEFAULT_VIEWPORT;
  const generationLineGap = getGenerationLineGap(
    activeTree ? generationLineGaps[activeTree.id] : undefined,
  );
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** The middle of the visible canvas, in flow coordinates. */
  const canvasCenter = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const screen = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return rfInstance?.screenToFlowPosition(screen) ?? { x: 0, y: 0 };
  };
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  // The person shown in the phone's pull-up card.
  const [peekMemberId, setPeekMemberId] = useState<string | null>(null);

  // Browser back/forward for canvas focus (#989) — skipped on the public,
  // chromeless view, which has no navigation panel to drive focus changes.
  const { restoringRef, updateHistoryViewport } = useCanvasHistory(
    publicView ? undefined : activeTree?.id,
    rfInstance,
  );

  // --- Extracted hooks ---
  const locator = useMemberLocator(members, rfInstance);

  // Center the target member after following a member→tree link: consume the
  // one-shot locate request once the member shows up in the loaded set. In
  // windowed mode the target may lie outside the current neighborhood —
  // re-focus the window on it once and locate after the reload.
  const attemptedFocusRef = useRef<string | null>(null);
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
      attemptedFocusRef.current = null;
      setPendingLocateMemberId(null);
      locator.locateMember(target);
      return;
    }
    if (members.length === 0) return; // still loading
    if (windowed && attemptedFocusRef.current !== pendingLocateMemberId) {
      attemptedFocusRef.current = pendingLocateMemberId;
      void setFocusRoot(pendingLocateMemberId);
      return;
    }
    // Fully loaded (or window already re-focused) and still absent: the
    // counterpart no longer exists — drop the request.
    attemptedFocusRef.current = null;
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
    const workspaceId = activeTree?.id;
    if (
      publicView ||
      !requestedState ||
      !workspaceId ||
      pending.editingMemberId
    ) {
      return;
    }

    const savedMember = members.find(
      (member) => member.id === requestedState.memberId,
    );
    if (savedMember) {
      attemptedMemberSheetRestoreRef.current = null;
      setOpenSheet(workspaceId, requestedState);
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
      clearOpenSheet(workspaceId);
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
    effectiveRelationTypes,
    edgeType,
  );

  // Resolve each union dot's colour the same way edges are styled: the
  // relation-type default merged with the admin override. Without this the
  // dot ignores configured colours (the edges are styled in the worker).
  const relationTypes = useWorkspaceStore((s) => s.relationTypes);
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
  // Carry the measured height: card height varies with content, and the side
  // handles sit at the measured mid-height.
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
    publicView,
    selection.isSelectionMode,
  );
  // On phones a tap opens the pull-up card instead of the name link or the
  // hover actions, and the tapped person keeps the selection ring.
  const displayNodes = useMemo(
    () =>
      isMobile && !publicView
        ? viewNodes.map((node) => ({
            ...node,
            selected: node.id === peekMemberId,
            data: {
              ...node.data,
              disableNameLink: true,
              onView: undefined,
              onEdit: undefined,
            },
          }))
        : viewNodes,
    [isMobile, publicView, viewNodes, peekMemberId],
  );
  const peekMember =
    isMobile && peekMemberId
      ? (members.find((m) => m.id === peekMemberId) ?? null)
      : null;

  const openPeek = (node: Node) => {
    setPeekMemberId(node.id);
    if (!rfInstance) return;
    // Lift the person into the upper part of the canvas so the card that
    // slides up from the bottom doesn't cover them.
    const { zoom } = rfInstance.getViewport();
    void rfInstance.setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + NODE_HEIGHT / 2 + (window.innerHeight * 0.15) / zoom,
      { zoom, duration: 250 },
    );
  };

  const addPersonFromHeader = () => {
    const center = canvasCenter();
    pending.createNew(
      createMember({
        x: center.x - NODE_WIDTH / 2,
        y: center.y - NODE_HEIGHT / 2,
      }),
    );
  };

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
    onBeforeDelete,
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

  // Re-center when the focus root changes in windowed mode, and once when
  // leaving it for the whole family — unless a popstate restore is in flight,
  // which applies the exact saved camera instead (#989).
  const previousFocusRef = useRef<string | null>(null);
  const focusKey = windowed
    ? JSON.stringify([
        focusRootId,
        focusSectionIds,
        activeSavedViewId,
        neighborhoodUp,
        neighborhoodDown,
      ])
    : null;
  useEffect(() => {
    if (!rfInstance || focusPending || !isReady) return;
    if (focusKey === previousFocusRef.current) return;
    // Store focus changes before React Flow receives its replacement nodes.
    // Fitting the old graph can leave a restored position overlay offscreen
    // and culled from the DOM. Wait until the new graph has reached the canvas.
    if (
      !members.every((member) => {
        const position = nodePositions.get(member.id);
        return (
          position?.x === member.position.x && position?.y === member.position.y
        );
      })
    )
      return;
    if (restoringRef.current) {
      previousFocusRef.current = focusKey;
      return;
    }
    const frame = requestAnimationFrame(() => {
      fitViewToAllNodes(rfInstance, 0.2);
      previousFocusRef.current = focusKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    focusKey,
    focusPending,
    isReady,
    members,
    nodePositions,
    rfInstance,
    restoringRef,
  ]);

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
    const center = canvasCenter();
    pending.addFirstMember({
      x: center.x - NODE_WIDTH / 2,
      y: center.y - NODE_HEIGHT / 2,
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

  if (!activeTree || !isReady) {
    // Keep the header (sidebar toggle, bell) while there is no workspace yet
    // or the canvas is still loading — otherwise phones lose the way back to
    // the navigation.
    return (
      <div className="flex h-full w-full flex-col">
        {!publicView && <PageHeader title={t("tree-view.header.title")} />}
        {!activeTree && availableTreeCount === 0 && (
          <div className="min-h-0 flex-1">
            <NoDatabasePlaceholder />
          </div>
        )}
      </div>
    );
  }

  const peopleCount = windowed
    ? (totalMemberCount ?? members.length)
    : members.length;

  return (
    <div className="flex h-full w-full flex-col">
      {!publicView &&
        (isMobile ? (
          // Phones: "Monogram Workspace ▾", search and add person, as in
          // the native apps' title bars.
          <PageHeader
            title={t("tree-view.header.title")}
            heading={<DatabaseSelector variant="header" />}
            inlineActions
            actions={
              canEditMembers ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label={t("tree-view.mobile.add-person")}
                  data-tutorial="add-member"
                  onClick={addPersonFromHeader}
                >
                  <UserPlus />
                </Button>
              ) : undefined
            }
          />
        ) : (
          <PageHeader
            title={t("tree-view.header.title")}
            subtitle={t("tree-view.header.people", { count: peopleCount })}
            actions={<PresenceChips />}
          />
        ))}
      <div
        ref={canvasRef}
        className="relative min-h-0 w-full flex-1 bg-canvas"
        aria-label={t("tree-view.canvas-label")}
      >
        <ReactFlow
          className={`ft-tree-canvas${inSelectionMode ? " cursor-crosshair" : ""}`}
          nodes={[...displayNodes, ...unionNodes]}
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
          onBeforeDelete={onBeforeDelete}
          // Lift a selected connection above its neighbours so its
          // highlight isn't hidden under crossing lines.
          elevateEdgesOnSelect
          defaultEdgeOptions={{ type: edgeType }}
          onSelectionChange={
            isCanvasReadOnly || connection.isConnectionMode
              ? undefined
              : onSelectionChange
          }
          onNodeClick={(event, node) => {
            if (
              isMobile &&
              !publicView &&
              !connection.isConnectionMode &&
              node.type === "familyMember"
            ) {
              openPeek(node);
              return;
            }
            connection.handleNodeClick(event, node);
          }}
          onPaneClick={isMobile ? () => setPeekMemberId(null) : undefined}
          minZoom={0.1}
          snapToGrid={true}
          snapGrid={SNAP_GRID}
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
            connection.isConnectionMode ||
            (!isLockedScreen && !isCanvasReadOnly)
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
            !connection.isConnectionMode &&
            !isCanvasReadOnly &&
            !inSelectionMode
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
          onMoveEnd={(_, vp) => {
            if (!activeTree) return;
            setViewport(activeTree.id, vp);
            updateHistoryViewport(vp);
          }}
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": t("tree-view.controls.zoom-in"),
            "controls.zoomOut.ariaLabel": t("tree-view.controls.zoom-out"),
            "controls.fitView.ariaLabel": t("tree-view.controls.fit-view"),
          }}
        >
          <SelectionModeController active={inSelectionMode} />
          <Background color="var(--canvas-dot)" gap={SNAP_GRID} size={1.4} />
          <GenerationLines
            visible={generationLineGap !== null}
            gap={generationLineGap ?? undefined}
          />
          <Panel
            position={isMobile ? "top-center" : "top-left"}
            className={isMobile ? "max-w-[calc(100vw-1.5rem)] pt-1" : "pt-2"}
          >
            <div className="flex flex-col items-center gap-1 md:items-stretch">
              <div className="flex items-start gap-2">
                {!publicView && (
                  <WorkspaceNavigationPanel
                    workspaceId={activeTree.id}
                    canWrite={canWrite}
                  />
                )}
                {/* Phones search from the header (people) and the
                  "Whole family" menu (the whole workspace). */}
                {(!isMobile || publicView) && (
                  <CanvasSearch
                    members={members}
                    onLocate={locator.locateMember}
                    className={isMobile ? "min-w-0 flex-1" : undefined}
                    windowed={windowed}
                    workspaceId={activeTree?.id}
                    onFocusRoot={setFocusRoot}
                    onOpenOtherTree={openTreeAndLocateMember}
                  />
                )}
              </div>
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
              <Panel
                position="top-center"
                className="!top-2 pointer-events-none"
              >
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
                      ns.map((n) =>
                        n.selected ? { ...n, selected: false } : n,
                      ),
                    );
                  }}
                >
                  {t("tree-view.selection.clear")}
                </Button>
              </div>
            </Panel>
          )}
          {(!isMobile || publicView) && (
            <Panel
              position="bottom-center"
              className="!m-0 !mb-4 !w-max max-w-[calc(100vw-2rem)]"
            >
              <div
                role="toolbar"
                aria-label={t("tree-view.controls.toolbar")}
                className="flex flex-wrap items-center justify-center gap-y-1 rounded-[1.375rem] border bg-card p-1 shadow-lg"
              >
                <FlowPanelControls
                  navigationOnly={isCanvasReadOnly}
                  isConnectionMode={connection.isConnectionMode}
                  connectionDisabled={members.length < 2}
                  onToggleConnectionMode={connection.toggleConnectionMode}
                  isSelectionMode={selection.isSelectionMode}
                  onToggleSelectionMode={selection.toggleSelectionMode}
                  selectionAvailable={!isCanvasReadOnly}
                  selectionDisabled={members.length < 1 || isLockedScreen}
                  showMoreMenu={isCanvasReadOnly}
                />
                {!isCanvasReadOnly && (
                  <>
                    <ToolbarSeparator />
                    <MemberControls
                      nodes={nodes}
                      selectedNodes={selectedNodes}
                      setMembersToDelete={setMembersToDelete}
                      onEditMember={(member) => pending.editExisting(member)}
                      onCreateNewMember={(member) => pending.createNew(member)}
                      onRearrange={rearrangeNodes}
                      leadingMenuItems={<CanvasMenuItems />}
                    />
                  </>
                )}
              </div>
            </Panel>
          )}
          {!publicView && windowed && (
            <ContinuationControls
              continuations={neighborhoodCursor ? continuations : []}
              atBudget={members.length >= EXPANSION_NODE_BUDGET}
              canExpandGeneration={
                neighborhoodExpandable &&
                (neighborhoodUp < 20 || neighborhoodDown < 20)
              }
              onExpandGeneration={() => void expandGeneration()}
              onLoadMore={() => void loadMoreNeighborhood()}
              onReset={() => void resetNeighborhood()}
            />
          )}
        </ReactFlow>
        {members.length === 0 && !publicView && canEditMembers && (
          // A plain overlay rather than a React Flow <Panel>: panels centre
          // themselves with their own transform and margin, which pushed this
          // card off-centre.
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-4">
            <div className="pointer-events-auto">
              <EmptyTreeState onAddFirstMember={handleAddFirstMember} />
            </div>
          </div>
        )}
        {isMobile && !publicView && (
          // Phones: pinch to zoom, one fit button, and the pull-up card for
          // the tapped person.
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col">
            <Button
              variant="outline"
              size="icon-lg"
              className="pointer-events-auto mr-3 mb-6 self-end rounded-2xl bg-card shadow-sm"
              aria-label={t("tree-view.controls.fit-view")}
              onClick={() => rfInstance && fitViewToAllNodes(rfInstance)}
            >
              <Maximize />
            </Button>
            {peekMember && (
              <div className="pointer-events-auto">
                <MemberPeekCard
                  member={peekMember}
                  canEdit={canEditMembers}
                  onView={() => {
                    pending.setEditingMemberId(peekMember.id);
                    pending.setIsEditMode(false);
                  }}
                  onEdit={() => pending.editExisting(peekMember)}
                  onAddParent={() => pending.onAddParent(peekMember.id)}
                  onAddPartner={() =>
                    pending.onAddHorizontal(peekMember.id, "right")
                  }
                  onAddChild={() => pending.onAddChild(peekMember.id)}
                  onClose={() => setPeekMemberId(null)}
                />
              </div>
            )}
          </div>
        )}
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
              canEdit={canEditMembers}
              isNewMember={pending.isNewMemberSession}
              onDiscardNewMember={pending.discardNewMember}
              onSaveNewMember={pending.saveNewMember}
              onOpenMember={(memberId) => {
                if (isMobile) setPeekMemberId(memberId);
                pending.setEditingMemberId(memberId);
                pending.setIsEditMode(false);
                const target = members.find((m) => m.id === memberId);
                if (target) locator.locateMember(target);
              }}
            />
            <AddRelationDialog
              isOpen={relation.isDialogOpen}
              onClose={relation.closeDialog}
              onConfirm={(type) => {
                // A horizontal add's relation is confirmed here, one step
                // after the new member itself was saved — check suggestions
                // for that member now rather than in saveNewMember, which
                // hasn't created this relation yet (#990).
                const newMemberId =
                  relation.pendingHorizontalRelation?.targetId;
                relation.confirmRelation(type);
                if (newMemberId) {
                  void pending.checkSectionSuggestions(newMemberId);
                }
              }}
            />
            <NewMemberSectionPrompt
              memberName={pending.sectionSuggestions?.memberName ?? ""}
              suggestions={pending.sectionSuggestions?.suggestions ?? null}
              onAdd={pending.addToSuggestedSection}
              onDismiss={pending.dismissSectionSuggestions}
            />
          </>
        )}
      </div>
    </div>
  );

  function initializeFlow() {
    // Rebuilt on every `members` change (incl. drag-position persistence), so
    // carry the selection and measured sizes over — see buildMemberNodes.
    setNodes((prevNodes) => buildMemberNodes(members, prevNodes));
  }
};
