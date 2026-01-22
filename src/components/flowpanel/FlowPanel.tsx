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
import { Toaster } from "@/components/ui/sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Member } from "@/types/member";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import debounce from "lodash.debounce";
import { FamilyNode } from "@/components/node/FamilyNode";
import { toast } from "sonner";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FlowPanelControls } from "@/components/flowpanel/FlowPanelControls";
import { MemberControls } from "@/components/flowpanel/MemberControls";

const nodeTypes = { familyMember: FamilyNode };

export const FlowPanel = () => {
  const activeDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const { members, isReady, connect, removeMember, updateMemberPartial } =
    useFamilyStore();
  const { edgeType, isLockedScreen } = useFamilyTreeSettings();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);

  const viewNodes = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const visibilityCache = new Map<string, boolean>();

    const isNodeVisible = (nodeId: string): boolean => {
      if (visibilityCache.has(nodeId)) return visibilityCache.get(nodeId)!;

      const node = nodeMap.get(nodeId);
      if (!node) return false;
      const member = node.data as Member;
      const parentIds = [member.parents.first, member.parents.second].filter(
        Boolean,
      );

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
    }));
  }, [nodes]);

  const pendingUpdates = useRef<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    void connect(activeDatabase.path);
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
  }, [members, isReady, setNodes, setEdges]);

  useEffect(() => {
    setSelectedNodes((prevSelected) => {
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      return prevSelected
        .map((node) => nodeMap.get(node.id))
        .filter((n) => n !== undefined);
    });
  }, [nodes]);

  const debouncedSave = useRef(
    debounce(() => {
      processUpdates();
    }, 1000),
  ).current;

  const processUpdates = useCallback(() => {
    Object.entries(pendingUpdates.current).forEach(([id, position]) => {
      void updateMemberPartial(id, {
        positionX: position.x,
        positionY: position.y,
      });
    });
    pendingUpdates.current = {};
  }, [updateMemberPartial]);

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
      } catch (e) {
        toast.error(
          "You cannot make a connection from the same parent to child twice.",
        );
      }
    },
    [edges],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => {
      setSelectedNodes(nodes);
    },
    [],
  );

  if (!isReady) return null;

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
          />
        </Panel>
      </ReactFlow>
      <RemoveNodeDialog
        isOpen={!!membersToDelete.length}
        members={membersToDelete}
        onConfirm={confirmDelete}
        onCancel={() => setMembersToDelete([])}
      />
      <Toaster />
    </div>
  );

  function addMemberEdge(edge: Edge) {
    if (edges.find((e) => e.id === edge.id))
      throw new Error(`Edge with id ${edge.id} already exists`);

    const firstOrSecond =
      edge.targetHandle === "left" ? "firstParentId" : "secondParentId";
    void updateMemberPartial(edge.target, {
      [firstOrSecond]: edge.source,
    });
  }

  function removeMemberEdge(change: EdgeRemoveChange) {
    const edge = edges.find((e) => e.id === change.id);
    if (!edge) return;
    const firstOrSecond =
      edge.targetHandle === "left" ? "firstParentId" : "secondParentId";
    void updateMemberPartial(edge.target, { [firstOrSecond]: null });
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
    setNodes((currentNodes) => {
      const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));

      return members.map((member) => {
        const existingNode = nodeMap.get(member.id);

        if (existingNode) {
          return {
            ...existingNode,
            data: member,
            position: existingNode.dragging
              ? existingNode.position
              : member.position,
          };
        }

        return {
          id: member.id,
          type: "familyMember",
          position: member.position,
          data: member,
        };
      });
    });
    const newEdges: Edge[] = [];
    members.forEach((m) => {
      if (m.parents.first) {
        newEdges.push({
          id: createEdgeId(m.parents.first, m.id),
          source: m.parents.first,
          target: m.id,
          targetHandle: "left",
          type: edgeType,
        });
      }
      if (m.parents.second) {
        newEdges.push({
          id: createEdgeId(m.parents.second, m.id),
          source: m.parents.second,
          target: m.id,
          targetHandle: "right",
          type: edgeType,
        });
      }
    });

    setEdges(newEdges);
  }
};
