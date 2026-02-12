import { Dispatch, SetStateAction, useCallback, useRef } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge,
  EdgeChange,
  EdgeRemoveChange,
  Node,
  NodeChange,
  NodePositionChange,
  OnSelectionChangeParams,
} from "@xyflow/react";
import { Member, RelationType } from "@/types/member";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import debounce from "lodash.debounce";

export const useFlowInteractions = (
  members: Member[],
  edges: Edge[],
  setNodes: Dispatch<SetStateAction<Node[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
  setMembersToDelete: Dispatch<SetStateAction<Member[]>>,
  setSelectedNodes: Dispatch<SetStateAction<Node[]>>,
  setNewRelation: Dispatch<SetStateAction<Connection | null>>,
) => {
  const { removeRelation, updateMemberPartial } = useFamilyStore();
  const pendingUpdates = useRef<Record<string, { x: number; y: number }>>({});

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

  const changeMemberPosition = useCallback(
    (change: NodePositionChange) => {
      if (change.position) {
        pendingUpdates.current[change.id] = change.position;
        debouncedSave();
      }
    },
    [debouncedSave],
  );

  const removeNodesById = useCallback(
    (ids: Set<string>) => {
      setNodes((currentNodes) => {
        const members = currentNodes
          .filter((n) => ids.has(n.id))
          .map((n) => n.data as Member);

        if (members.length > 0) {
          setMembersToDelete(members);
        }

        return currentNodes;
      });
    },
    [setNodes, setMembersToDelete],
  );

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
    [setNodes, changeMemberPosition, removeNodesById],
  );

  const removeMemberEdge = useCallback(
    (change: EdgeRemoveChange) => {
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
    },
    [members, edges, removeRelation, updateMemberPartial],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removeChanges = changes.filter((c) => c.type === "remove");
      removeChanges.forEach(removeMemberEdge);
      setEdges((edgeSnapshot) => applyEdgeChanges(changes, edgeSnapshot));
    },
    [edges, removeMemberEdge, setEdges],
  );

  const createEdgeId = (source: string, target: string) =>
    `e:${source}:${target}`;

  const addMemberEdge = useCallback(
    (edge: Connection) => {
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
    },
    [edges, members, updateMemberPartial, setNewRelation],
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
    [addMemberEdge],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => {
      setSelectedNodes(nodes);
    },
    [setSelectedNodes],
  );

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
    onSelectionChange,
    debouncedSave,
    pendingUpdates,
  };
};
