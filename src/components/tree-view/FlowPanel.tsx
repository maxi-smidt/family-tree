import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  Edge,
  EdgeChange,
  EdgeRemoveChange,
  Node,
  NodeChange,
  NodePositionChange,
  OnSelectionChangeParams,
  Panel,
  ReactFlow,
} from "@xyflow/react";
import { RemoveNodeDialog } from "@/components/dialog/RemoveNodeDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Member } from "@/types/member";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import debounce from "lodash.debounce";
import { toast } from "sonner";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FlowPanelControls } from "@/components/tree-view/FlowPanelControls";
import { MemberControls } from "@/components/tree-view/MemberControls";
import { MemberSheet } from "@/components/sheet/MemberSheet";
import { FamilyNode } from "@/components/tree-view/node/FamilyNode";

const nodeTypes = { familyMember: FamilyNode };

export const FlowPanel = () => {
  const activeDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const {
    members,
    isReady,
    connect,
    removeMember,
    updateMemberPartial,
    updateLayout,
  } = useFamilyStore();
  const { edgeType, isLockedScreen } = useFamilyTreeSettings();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const editingMember = useMemo(
    () => members.find((m) => m.id === editingMemberId) || null,
    [members, editingMemberId],
  );

  const viewNodes = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const visibilityCache = new Map<string, boolean>();

    const isNodeVisible = (nodeId: string): boolean => {
      if (visibilityCache.has(nodeId)) return visibilityCache.get(nodeId)!;

      const node = nodeMap.get(nodeId);
      if (!node) return false;
      const member = node.data as Member;
      const parentIds = [
        member.parents.maternalParent,
        member.parents.paternalParent,
      ].filter(Boolean);

      if (parentIds.length === 0) {
        visibilityCache.set(nodeId, true);
        return true;
      }

      const isVisible = parentIds.every((parentId) => {
        const parent = nodeMap.get(parentId as string);
        if (!parent) return true;
        return !parent.data.isCollapsed && isNodeVisible(parentId as string);
      });

      visibilityCache.set(nodeId, isVisible);
      return isVisible;
    };

    return nodes.map((node) => ({
      ...node,
      hidden: !isNodeVisible(node.id),
      data: {
        ...node.data,
        onEdit: () => {
          setEditingMemberId(node.id);
          setIsEditMode(true);
        },
        onView: () => {
          setEditingMemberId(node.id);
          setIsEditMode(false);
        },
      },
    }));
  }, [nodes]);

  const pendingUpdates = useRef<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    if (activeDatabase) void connect(activeDatabase);
  }, [connect, activeDatabase]);

  useEffect(() => {
    setEdges((edges) =>
      edges.map((edge) => ({
        ...edge,
        type: edgeType,
      })),
    );
  }, [edgeType]);

  useEffect(() => {
    if (!isReady) return;
    initializeFlow();
  }, [members, isReady]);

  useEffect(() => {
    setSelectedNodes((prevSelected) => {
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      return prevSelected
        .map((node) => nodeMap.get(node.id))
        .filter((n) => n !== undefined);
    });
  }, [nodes]);

  const processUpdates = useCallback(() => {
    Object.entries(pendingUpdates.current).forEach(([id, position]) => {
      void updateMemberPartial(id, {
        positionX: position.x,
        positionY: position.y,
      });
    });
    pendingUpdates.current = {};
  }, [updateMemberPartial]);

  const debouncedSave = useRef(debounce(processUpdates, 1000)).current;

  const rearrangeNodes = () => {
    debouncedSave.cancel();
    pendingUpdates.current = {};

    updateLayout().then();
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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removeChanges = changes.filter((c) => c.type === "remove");
      const otherChanges = changes.filter((c) => c.type !== "remove");

      if (otherChanges.length > 0) {
        setNodes((nds) => applyNodeChanges(otherChanges, nds));
        otherChanges.forEach((change) => {
          if (change.type === "position") changeMemberPosition(change);
        });
      }

      if (removeChanges.length > 0) {
        const idsToDelete = new Set(removeChanges.map((c) => c.id));
        removeNodesById(idsToDelete);
      }
    },
    [setNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removeChanges = changes.filter((c) => c.type === "remove");
      removeChanges.forEach(removeMemberEdge);
      setEdges((edgeSnapshot) => applyEdgeChanges(changes, edgeSnapshot));
    },
    [edges],
  );
  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        ...params,
        id: createEdgeId(params.source, params.target),
      } as Edge;
      try {
        addMemberEdge(newEdge);
        setEdges((edgesSnapshot) => addEdge(newEdge, edgesSnapshot));
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [edges, members],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => {
      setSelectedNodes(nodes);
    },
    [],
  );

  if (!isReady || !activeDatabase) return null;

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={viewNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultEdgeOptions={{ type: edgeType }}
        onSelectionChange={onSelectionChange}
        minZoom={0.1}
        snapToGrid={true}
        snapGrid={[50, 50]}
        nodesDraggable={!isLockedScreen}
        nodesConnectable={!isLockedScreen}
        elementsSelectable={!isLockedScreen}
        fitView
      >
        <Background />
        <Panel position="bottom-left" className="pb-2">
          <FlowPanelControls />
        </Panel>
        <Panel position="bottom-right" className="pb-2">
          <MemberControls
            nodes={nodes}
            selectedNodes={selectedNodes}
            setMembersToDelete={setMembersToDelete}
            onEditMember={(member) => {
              setEditingMemberId(member.id);
              setIsEditMode(true);
            }}
            onRearrange={rearrangeNodes}
          />
        </Panel>
      </ReactFlow>
      <RemoveNodeDialog
        isOpen={!!membersToDelete.length}
        members={membersToDelete}
        onConfirm={confirmDelete}
        onCancel={() => setMembersToDelete([])}
      />
      <MemberSheet
        isOpen={!!editingMember}
        onClose={() => setEditingMemberId(null)}
        member={editingMember}
        initialEditMode={isEditMode}
      />
    </div>
  );

  function addMemberEdge(edge: Edge) {
    if (edges.find((e) => e.id === edge.id))
      throw new Error(`Edge with id ${edge.id} already exists`);

    const parentMember = members.find((m) => m.id === edge.source);
    if (!parentMember) throw new Error("Parent member not found");

    const childMember = members.find((m) => m.id === edge.target);
    if (!childMember) throw new Error("Child member not found");

    if (parentMember.gender === "female") {
      void updateMemberPartial(edge.target, {
        maternalParentId: edge.source,
      });
    } else if (parentMember.gender === "male") {
      void updateMemberPartial(edge.target, {
        paternalParentId: edge.source,
      });
    } else {
      if (!childMember.parents.paternalParent) {
        void updateMemberPartial(edge.target, {
          paternalParentId: edge.source,
        });
      } else if (!childMember.parents.maternalParent) {
        void updateMemberPartial(edge.target, {
          maternalParentId: edge.source,
        });
      } else {
        throw new Error("Both parent slots are full");
      }
    }
  }

  function removeMemberEdge(change: EdgeRemoveChange) {
    const edge = edges.find((e) => e.id === change.id);
    if (!edge) return;

    const childMember = members.find((m) => m.id === edge.target);
    if (!childMember) return;

    if (childMember.parents.maternalParent === edge.source) {
      void updateMemberPartial(edge.target, { maternalParentId: undefined });
    } else if (childMember.parents.paternalParent === edge.source) {
      void updateMemberPartial(edge.target, { paternalParentId: undefined });
    }
  }

  function changeMemberPosition(change: NodePositionChange) {
    if (change.position) {
      pendingUpdates.current[change.id] = change.position;
      debouncedSave();
    }
  }

  function createEdgeId(source: string, target: string) {
    return `e-${source}-${target}`;
  }

  function removeNodesById(ids: Set<string>) {
    setNodes((currentNodes) => {
      const members = currentNodes
        .filter((n) => ids.has(n.id))
        .map((n) => n.data as Member);

      if (members.length > 0) {
        setMembersToDelete(members);
      }

      return currentNodes;
    });
  }

  function initializeFlow() {
    const newNodes = members.map((member) => ({
      id: member.id,
      type: "familyMember",
      position: member.position,
      data: member,
    }));
    setNodes(newNodes);

    const newEdges: Edge[] = [];
    members.forEach((m) => {
      if (m.parents.maternalParent) {
        newEdges.push({
          id: createEdgeId(m.parents.maternalParent, m.id),
          source: m.parents.maternalParent,
          target: m.id,
          type: edgeType,
        });
      }
      if (m.parents.paternalParent) {
        newEdges.push({
          id: createEdgeId(m.parents.paternalParent, m.id),
          source: m.parents.paternalParent,
          target: m.id,
          type: edgeType,
        });
      }
    });

    setEdges(newEdges);
  }
};
