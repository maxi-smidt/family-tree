import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  EdgeRemoveChange,
  Node,
  NodeChange,
  NodePositionChange,
  Panel,
  ReactFlow,
  ReactFlowInstance,
} from "@xyflow/react";
import "./App.css";
import { useFamilyStore } from "./hooks/useFamilyStore";
import { FamilyNode } from "@/components/node/FamilyNode.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Member } from "@/types/member.ts";
import debounce from "lodash.debounce";
import { RemoveNodeDialog } from "@/components/dialog/RemoveNodeDialog.tsx";
import { Toaster, toast } from "sonner";

const nodeTypes = { familyMember: FamilyNode };

export default function App() {
  const {
    members,
    isReady,
    init,
    addMember,
    removeMember,
    updateMemberPartial,
  } = useFamilyStore();

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [membersToDelete, setMembersToDelete] = useState<Member[]>([]);

  const pendingUpdates = useRef<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!isReady) return;
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
          type: "step",
        });
      }
      if (m.parents.second) {
        newEdges.push({
          id: createEdgeId(m.parents.second, m.id),
          source: m.parents.second,
          target: m.id,
          targetHandle: "right",
          type: "step",
        });
      }
    });

    setEdges(newEdges);
  }, [members, isReady, setNodes, setEdges]);

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
        setNodes((currentNodes) => {
          const idsToDelete = new Set(removeChanges.map((c) => c.id));

          const members = currentNodes
            .filter((n) => idsToDelete.has(n.id))
            .map((n) => n.data as Member);

          if (members.length > 0) {
            setMembersToDelete(members);
          }

          return currentNodes;
        });
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

  if (!isReady) return null;

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <ReactFlow
        onInit={setRfInstance}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultEdgeOptions={{ type: "step" }}
        minZoom={0.1}
        fitView
      >
        <Background />
        <Controls />
        <Panel position="bottom-center">
          <Button variant="success" onClick={onAddMember}>
            Add Person
          </Button>
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

  function onAddMember() {
    let position = { x: 0, y: 0 };

    if (rfInstance) {
      position = rfInstance.screenToFlowPosition({
        x: 10,
        y: 10,
      });
    }

    void addMember({
      id: crypto.randomUUID(),
      firstName: "New",
      lastName: "Member",
      imageData: null,
      date: { birth: "2026", death: null },
      parents: { first: null, second: null },
      additionalData: null,
      position: position,
    });
  }

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
}
