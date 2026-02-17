import {
  Background,
  ConnectionMode,
  Edge,
  Node,
  Panel,
  ReactFlow,
  ReactFlowInstance,
} from "@xyflow/react";
import { RemoveMemberDialog } from "@/components/shared/dialog/RemoveMemberDialog";
import { useEffect, useMemo, useState } from "react";
import { Member } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FlowPanelControls } from "@/components/view/tree-view/FlowPanelControls";
import { MemberControls } from "@/components/view/tree-view/MemberControls";
import { MemberSheet } from "@/components/shared/member-sheet/MemberSheet";
import { FamilyNode } from "@/components/view/tree-view/node/FamilyNode";
import { AddRelationDialog } from "@/components/view/tree-view/dialog/AddRelationDialog";
import { RelationEdge } from "@/components/view/tree-view/edge/RelationEdge";
import { useFlowNodes } from "@/hooks/useFlowNodes";
import { useFlowEdges } from "@/hooks/useFlowEdges";
import { useFlowInteractions } from "@/hooks/useFlowInteractions";

const nodeTypes = { familyMember: FamilyNode };
const edgeTypes = { relation: RelationEdge };

export const FlowPanel = () => {
  const activeDatabase = useFamilyTreeSettings((s) => s.selectedDatabase);
  const {
    members,
    removeMember,
    updateLayout,
    addRelation,
    removeRelation,
    addMember,
  } = useMemberStore();
  const { isReady, connect } = useDatabaseStore();
  const {
    edgeType,
    isLockedScreen,
    visibleRelationTypes,
    toggleRelationType,
    viewport,
    setViewport,
  } = useFamilyTreeSettings();
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [newRelation, setNewRelation] = useState<any | null>(null);

  const editingMember = useMemo(
    () => members.find((m) => m.id === editingMemberId) || null,
    [members, editingMemberId],
  );

  const onAddChild = async (parentId: string) => {
    const parent = members.find((m) => m.id === parentId);
    if (!parent) return;

    const position = {
      x: parent.position.x,
      y: parent.position.y + 200, // Place below parent
    };

    const newMember: Member = {
      id: crypto.randomUUID(),
      gender: "o",
      firstName: "New",
      lastName: "Child",
      maidenName: null,
      imageData: null,
      date: { birth: "2026", death: null },
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: position,
    };

    await addMember(newMember);
    // Relation: Child -> Parent
    await addRelation(newMember.id, parentId, "parent");

    setEditingMemberId(newMember.id);
    setIsEditMode(true);
  };

  const onAddParent = async (childId: string) => {
    const child = members.find((m) => m.id === childId);
    if (!child) return;

    const position = {
      x: child.position.x,
      y: child.position.y - 200, // Place above child
    };

    const newMember: Member = {
      id: crypto.randomUUID(),
      gender: "o",
      firstName: "New",
      lastName: "Parent",
      maidenName: null,
      imageData: null,
      date: { birth: "1980", death: null },
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: position,
    };

    await addMember(newMember);
    // Relation: Child -> Parent
    await addRelation(childId, newMember.id, "parent");

    setEditingMemberId(newMember.id);
    setIsEditMode(true);
  };

  const viewNodes = useFlowNodes(
    nodes,
    setEditingMemberId,
    setIsEditMode,
    onAddChild,
    onAddParent,
  );
  const viewEdges = useFlowEdges(members, visibleRelationTypes, edgeType);

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
    setNewRelation,
  );

  useEffect(() => {
    if (activeDatabase) void connect(activeDatabase);
  }, [connect, activeDatabase]);

  useEffect(() => {
    setEdges(viewEdges);
  }, [viewEdges]);

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
        defaultViewport={viewport}
        onMoveEnd={(_, viewport) => setViewport(viewport)}
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
      <RemoveMemberDialog
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
