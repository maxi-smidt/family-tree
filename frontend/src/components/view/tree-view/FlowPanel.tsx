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
import { useEffect, useMemo, useRef, useState } from "react";
import { createMember, Member, RelationType } from "@/types/member";
import { NODE_WIDTH } from "@/constants";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { FlowPanelControls } from "@/components/view/tree-view/FlowPanelControls";
import { CanvasSearch } from "@/components/view/tree-view/CanvasSearch";
import { EmptyTreeState } from "@/components/view/tree-view/EmptyTreeState";
import { MemberControls } from "@/components/view/tree-view/MemberControls";
import { MemberSheet } from "@/components/shared/member-sheet/MemberSheet";
import { FamilyNode } from "@/components/view/tree-view/node/FamilyNode";
import { AddRelationDialog } from "@/components/view/tree-view/dialog/AddRelationDialog";
import { RelationEdge } from "@/components/view/tree-view/edge/RelationEdge";
import { useFlowNodes } from "@/hooks/useFlowNodes";
import { useFlowEdges } from "@/hooks/useFlowEdges";
import { useFlowInteractions } from "@/hooks/useFlowInteractions";
import { useUndoRedo } from "@/hooks/useUndoRedo";

const nodeTypes = { familyMember: FamilyNode };
const edgeTypes = { relation: RelationEdge };

export const FlowPanel = () => {
  const activeTree = useTreeStore((s) => s.selectedTree);
  const {
    members,
    removeMember,
    updateLayout,
    addRelation,
    removeRelation,
    addMember,
    updateMemberPartial,
  } = useMemberStore();
  useUndoRedo();
  const { isReady } = useTreeStore();
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
  const [isNewMemberSession, setIsNewMemberSession] = useState(false);
  const [pendingNewMember, setPendingNewMember] = useState<Member | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(
    null,
  );
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [pendingHorizontalRelation, setPendingHorizontalRelation] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const [pendingHorizontalSourceId, setPendingHorizontalSourceId] = useState<
    string | null
  >(null);
  const [pendingRelation, setPendingRelation] = useState<
    | { type: "child-of"; parentId: string }
    | { type: "parent-of"; childId: string }
    | { type: "related"; sourceId: string; relationType: RelationType }
    | null
  >(null);

  const editingMember = useMemo(
    () =>
      pendingNewMember && editingMemberId === pendingNewMember.id
        ? pendingNewMember
        : members.find((m) => m.id === editingMemberId) || null,
    [members, editingMemberId, pendingNewMember],
  );

  const onAddChild = (parentId: string) => {
    const parent = members.find((m) => m.id === parentId);
    if (!parent) return;

    const newMember = createMember({
      x: parent.position.x,
      y: parent.position.y + 200,
    });
    setPendingNewMember(newMember);
    setPendingRelation({ type: "child-of", parentId });
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  const onAddParent = (childId: string) => {
    const child = members.find((m) => m.id === childId);
    if (!child) return;

    const newMember = createMember({
      x: child.position.x,
      y: child.position.y - 200,
    });
    setPendingNewMember(newMember);
    setPendingRelation({ type: "parent-of", childId });
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  const onAddHorizontal = (memberId: string, side: "left" | "right") => {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;

    const newMember = createMember({
      x: member.position.x + (side === "left" ? -300 : 300),
      y: member.position.y,
    });
    setPendingNewMember(newMember);
    setPendingHorizontalSourceId(memberId);
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
  };

  const viewNodes = useFlowNodes(
    nodes,
    setEditingMemberId,
    setIsEditMode,
    onAddChild,
    onAddParent,
    (id) => onAddHorizontal(id, "left"),
    (id) => onAddHorizontal(id, "right"),
    highlightedNodeId,
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

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const rearrangeNodes = () => {
    debouncedSave.cancel();
    pendingUpdates.current = {};
    updateLayout().then(() => rfInstance?.fitView());
  };

  // Un-collapse any ancestor that is currently hiding the member so the node
  // becomes visible before we pan to it.
  const revealMemberAncestors = (memberId: string) => {
    const byId = new Map(members.map((m) => [m.id, m]));
    const visited = new Set<string>();
    const queue = [memberId];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const member = byId.get(id);
      if (!member) continue;
      for (const parentId of [
        member.parents.maternalParent,
        member.parents.paternalParent,
      ]) {
        if (!parentId) continue;
        const parent = byId.get(parentId);
        if (parent?.isCollapsed) {
          void updateMemberPartial(parentId, { isCollapsed: false });
        }
        queue.push(parentId);
      }
    }
  };

  const locateMember = (member: Member) => {
    revealMemberAncestors(member.id);

    const node = rfInstance?.getNode(member.id);
    const width = node?.measured?.width ?? NODE_WIDTH;
    const height = node?.measured?.height ?? 0;
    const centerX = (node?.position.x ?? member.position.x) + width / 2;
    const centerY = (node?.position.y ?? member.position.y) + height / 2;

    rfInstance?.setCenter(centerX, centerY, {
      zoom: Math.max(rfInstance.getZoom(), 1.2),
      duration: 800,
    });

    setHighlightedNodeId(member.id);
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(
      () => setHighlightedNodeId(null),
      2500,
    );
  };

  const handleAddFirstMember = () => {
    if (!rfInstance) return;
    const flowPoint = rfInstance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const newMember = createMember({
      x: flowPoint.x - NODE_WIDTH / 2,
      y: flowPoint.y,
    });
    setPendingNewMember(newMember);
    setEditingMemberId(newMember.id);
    setIsEditMode(true);
    setIsNewMemberSession(true);
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
        {members.length === 0 && (
          <Panel
            position="top-center"
            className="!left-1/2 !-translate-x-1/2 !top-1/2 !-translate-y-1/2"
          >
            <EmptyTreeState onAddFirstMember={handleAddFirstMember} />
          </Panel>
        )}
        <Panel position="top-left" className="pt-2">
          <CanvasSearch members={members} onLocate={locateMember} />
        </Panel>
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
              setIsNewMemberSession(false);
            }}
            onCreateNewMember={(member) => {
              setPendingNewMember(member);
              setEditingMemberId(member.id);
              setIsEditMode(true);
              setIsNewMemberSession(true);
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
        onClose={() => {
          setEditingMemberId(null);
          setIsNewMemberSession(false);
          setPendingNewMember(null);
          setPendingRelation(null);
          setPendingHorizontalSourceId(null);
        }}
        member={editingMember}
        initialEditMode={isEditMode}
        isNewMember={isNewMemberSession}
        onDiscardNewMember={() => {
          setPendingNewMember(null);
          setPendingRelation(null);
          setPendingHorizontalSourceId(null);
        }}
        onSaveNewMember={async (data) => {
          if (pendingNewMember) {
            const newMemberToSave = { ...pendingNewMember, ...data };
            await addMember(newMemberToSave);
            if (pendingRelation) {
              const id = newMemberToSave.id;
              if (pendingRelation.type === "child-of") {
                await addRelation(id, pendingRelation.parentId, "parent");
              } else if (pendingRelation.type === "parent-of") {
                await addRelation(pendingRelation.childId, id, "parent");
              } else if (pendingRelation.type === "related") {
                await addRelation(
                  pendingRelation.sourceId,
                  id,
                  pendingRelation.relationType,
                );
              }
              setPendingRelation(null);
            }
            if (pendingHorizontalSourceId) {
              // Member saved — now ask for the relation type.
              setPendingHorizontalRelation({
                sourceId: pendingHorizontalSourceId,
                targetId: newMemberToSave.id,
              });
              setPendingHorizontalSourceId(null);
              setEditingMemberId(null);
              setIsNewMemberSession(false);
            }
            setPendingNewMember(null);
          }
        }}
      />
      <AddRelationDialog
        isOpen={!!newRelation || !!pendingHorizontalRelation}
        onClose={() => {
          setNewRelation(null);
          setPendingHorizontalRelation(null);
        }}
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
          } else if (pendingHorizontalRelation) {
            // Member was already saved — create the relation directly.
            const { sourceId, targetId } = pendingHorizontalRelation;
            void addRelation(sourceId, targetId, type);
            if (!visibleRelationTypes.includes(type)) {
              toggleRelationType(type);
            }
          }
          setNewRelation(null);
          setPendingHorizontalRelation(null);
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
