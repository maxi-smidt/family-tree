import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  ConnectionMode,
  Edge,
  EdgeChange,
  EdgeRemoveChange,
  Node,
  NodeChange,
  NodePositionChange,
  OnSelectionChangeParams,
  Panel,
  ReactFlow,
  ReactFlowInstance,
} from "@xyflow/react";
import { RemoveNodeDialog } from "@/components/dialog/RemoveNodeDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Member, RelationType } from "@/types/member";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import debounce from "lodash.debounce";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FlowPanelControls } from "@/components/tree-view/FlowPanelControls";
import { MemberControls } from "@/components/tree-view/MemberControls";
import { MemberSheet } from "@/components/sheet/MemberSheet";
import { FamilyNode } from "@/components/tree-view/node/FamilyNode";
import { AddRelationDialog } from "@/components/dialog/AddRelationDialog";
import { RelationEdge } from "@/components/tree-view/edge/RelationEdge";

const nodeTypes = { familyMember: FamilyNode };
const edgeTypes = { relation: RelationEdge };

export const FlowPanel = () => {
  const activeDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const {
    members,
    isReady,
    connect,
    removeMember,
    updateMemberPartial,
    updateLayout,
    addRelation,
    removeRelation,
  } = useFamilyStore();
  const { edgeType, isLockedScreen, visibleRelationTypes, toggleRelationType } =
    useFamilyTreeSettings();
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [newRelation, setNewRelation] = useState<Connection | null>(null);

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
  }, [members, isReady, visibleRelationTypes]);

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
    updateLayout().then(() => rfInstance?.fitView());
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
        addMemberEdge(newEdge as Connection);
      } catch (e: any) {
        console.error(e.message);
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
        edgeTypes={edgeTypes}
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
        connectionMode={ConnectionMode.Loose}
        onInit={setRfInstance}
      >
        <Background />
        <Panel position="bottom-left" className="pb-2 flex flex-col gap-2">
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
      <AddRelationDialog
        isOpen={!!newRelation}
        onClose={() => setNewRelation(null)}
        onConfirm={(type) => {
          if (newRelation) {
            const fromId = newRelation.source;
            const toId = newRelation.target;

            const sourceMember = members.find((m) => m.id === fromId);
            const forwardRel = sourceMember?.relations?.find(
              (r) => r.toMemberId === toId && r.relationType !== "parent",
            );
            if (forwardRel) {
              void removeRelation(fromId, toId, forwardRel.relationType);
            }

            const targetMember = members.find((m) => m.id === toId);
            const backwardRel = targetMember?.relations?.find(
              (r) => r.toMemberId === fromId && r.relationType !== "parent",
            );
            if (backwardRel) {
              void removeRelation(toId, fromId, backwardRel.relationType);
            }

            void addRelation(fromId, toId, type);
            if (!visibleRelationTypes.includes(type)) {
              toggleRelationType(type);
            }
          }
          setNewRelation(null);
        }}
      />
    </div>
  );

  function addMemberEdge(edge: Connection) {
    if (edges.find((e) => e.id === createEdgeId(edge.source, edge.target)))
      throw new Error(`Edge already exists`);

    const sourceMember = members.find((m) => m.id === edge.source);
    if (!sourceMember) throw new Error("Source member not found");

    const targetMember = members.find((m) => m.id === edge.target);
    if (!targetMember) throw new Error("Target member not found");

    const isHorizontal =
      edge.sourceHandle === "left" || edge.sourceHandle === "right";

    if (isHorizontal) {
      const isParent =
        targetMember.parents.paternalParent === edge.source ||
        targetMember.parents.maternalParent === edge.source;
      const isChild =
        sourceMember.parents.paternalParent === edge.target ||
        sourceMember.parents.maternalParent === edge.target;

      if (isParent || isChild) {
        throw new Error(
          "Cannot add horizontal relation between parent and child",
        );
      }

      setNewRelation(edge);
      return;
    }

    if (sourceMember.gender === "female") {
      void updateMemberPartial(edge.target, {
        maternalParentId: edge.source,
      });
    } else if (sourceMember.gender === "male") {
      void updateMemberPartial(edge.target, {
        paternalParentId: edge.source,
      });
    } else {
      if (!targetMember.parents.paternalParent) {
        void updateMemberPartial(edge.target, {
          paternalParentId: edge.source,
        });
      } else if (!targetMember.parents.maternalParent) {
        void updateMemberPartial(edge.target, {
          maternalParentId: edge.source,
        });
      } else {
        throw new Error("Both parent slots are full");
      }
    }
  }

  function removeMemberEdge(change: EdgeRemoveChange) {
    const { members, removeRelation, updateMemberPartial } =
      useFamilyStore.getState();

    if (change.id.startsWith("rel:")) {
      const parts = change.id.split(":");
      if (parts.length >= 4) {
        const sourceId = parts[1];
        const targetId = parts[2];
        const type = parts[3] as RelationType;
        void removeRelation(sourceId, targetId, type);
        void removeRelation(targetId, sourceId, type);
      }
      return;
    }

    // Try to parse ID directly for vertical relations
    if (change.id.startsWith("e:")) {
      const parts = change.id.split(":");
      if (parts.length >= 3) {
        const source = parts[1];
        const target = parts[2];

        const childMember = members.find((m) => m.id === target);
        if (childMember) {
          if (childMember.parents.maternalParent === source) {
            void updateMemberPartial(target, {
              maternalParentId: null as unknown as string,
            });
          } else if (childMember.parents.paternalParent === source) {
            void updateMemberPartial(target, {
              paternalParentId: null as unknown as string,
            });
          }
        }
      }
      return;
    }

    // Fallback to old logic if ID format doesn't match (though it should)
    const edge = edges.find((e) => e.id === change.id);
    if (!edge) return;

    const childMember = members.find((m) => m.id === edge.target);
    if (!childMember) return;

    if (childMember.parents.maternalParent === edge.source) {
      void updateMemberPartial(edge.target, {
        maternalParentId: null as unknown as string,
      });
    } else if (childMember.parents.paternalParent === edge.source) {
      void updateMemberPartial(edge.target, {
        paternalParentId: null as unknown as string,
      });
    }
  }

  function changeMemberPosition(change: NodePositionChange) {
    if (change.position) {
      pendingUpdates.current[change.id] = change.position;
      debouncedSave();
    }
  }

  function createEdgeId(source: string, target: string) {
    return `e:${source}:${target}`;
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
    const processedPairs = new Set<string>();

    members.forEach((m) => {
      if (visibleRelationTypes.includes("parent")) {
        if (m.parents.maternalParent) {
          newEdges.push({
            id: createEdgeId(m.parents.maternalParent, m.id),
            source: m.parents.maternalParent,
            target: m.id,
            type: edgeType,
            sourceHandle: "bottom",
            targetHandle: "top",
          });
        }
        if (m.parents.paternalParent) {
          newEdges.push({
            id: createEdgeId(m.parents.paternalParent, m.id),
            source: m.parents.paternalParent,
            target: m.id,
            type: edgeType,
            sourceHandle: "bottom",
            targetHandle: "top",
          });
        }
      }

      if (m.relations) {
        m.relations.forEach((rel) => {
          if (
            rel.relationType !== "parent" &&
            visibleRelationTypes.includes(rel.relationType)
          ) {
            const pairKey = [m.id, rel.toMemberId].sort().join("-");
            if (processedPairs.has(pairKey)) return;
            processedPairs.add(pairKey);

            let strokeColor = "#999";
            let strokeDasharray = "5,5";

            switch (rel.relationType) {
              case "married":
                strokeColor = "#22c55e";
                strokeDasharray = "0";
                break;
              case "divorced":
                strokeColor = "#ef4444";
                strokeDasharray = "5,5";
                break;
              case "partner":
                strokeColor = "#3b82f6";
                strokeDasharray = "5,5";
                break;
              case "sibling":
                strokeColor = "#eab308";
                strokeDasharray = "0";
                break;
            }

            newEdges.push({
              id: `rel:${m.id}:${rel.toMemberId}:${rel.relationType}`,
              source: m.id,
              target: rel.toMemberId,
              sourceHandle: "right",
              targetHandle: "left",
              type: "relation",
              style: {
                stroke: strokeColor,
                strokeDasharray: strokeDasharray,
                strokeWidth: 2,
              },
              animated: false,
            });
          }
        });
      }
    });

    setEdges(newEdges);
  }
};
