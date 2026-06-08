import {
  Dispatch,
  SetStateAction,
  useCallback,
  useRef,
  useEffect,
} from "react";
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
import { useMemberStore } from "@/hooks/useMemberStore";
import debounce from "lodash.debounce";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const useFlowInteractions = (
  members: Member[],
  edges: Edge[],
  setNodes: Dispatch<SetStateAction<Node[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
  setMembersToDelete: Dispatch<SetStateAction<Member[]>>,
  setSelectedNodes: Dispatch<SetStateAction<Node[]>>,
  setNewRelation: Dispatch<SetStateAction<Connection | null>>,
) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "hooks.flow-interactions",
  });
  const { removeRelation, updateMemberPartial, persistPositions } =
    useMemberStore();
  const pendingUpdates = useRef<Record<string, { x: number; y: number }>>({});

  const memberMap = useRef(new Map<string, Member>()).current;

  const processUpdates = useCallback(() => {
    const positions = Object.entries(pendingUpdates.current).map(
      ([id, position]) => ({ id, x: position.x, y: position.y }),
    );
    pendingUpdates.current = {};
    void persistPositions(positions);
  }, [persistPositions]);

  const debouncedSave = useRef(debounce(processUpdates, 1000)).current;

  const changeMemberPosition = useCallback(
    (change: NodePositionChange) => {
      // Union nodes are ephemeral — never persist their positions.
      if (change.position && !change.id.startsWith("union-")) {
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
          .filter((n) => ids.has(n.id) && !n.id.startsWith("union-"))
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

          const childMember = memberMap.get(target);
          if (childMember) {
            if (childMember.parents.maternalParent === source) {
              void updateMemberPartial(target, {
                maternalParentId: null,
              });
            } else if (childMember.parents.paternalParent === source) {
              void updateMemberPartial(target, {
                paternalParentId: null,
              });
            }
          }
        }
        return;
      }

      const edge = edges.find((e) => e.id === change.id);
      if (!edge) return;

      const childMember = memberMap.get(edge.target);
      if (!childMember) return;

      if (childMember.parents.maternalParent === edge.source) {
        void updateMemberPartial(edge.target, {
          maternalParentId: null,
        });
      } else if (childMember.parents.paternalParent === edge.source) {
        void updateMemberPartial(edge.target, {
          paternalParentId: null,
        });
      }
    },
    [memberMap, edges, removeRelation, updateMemberPartial],
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

  useEffect(() => {
    memberMap.clear();
    members.forEach((m) => memberMap.set(m.id, m));
  }, [members, memberMap]);

  const isDescendant = (
    potentialAncestorId: string,
    potentialDescendantId: string,
    visited: Set<string> = new Set(),
  ): boolean => {
    // Guard against pre-existing cycles in the data so a malformed tree can't
    // send this recursion into an infinite loop / stack overflow.
    if (visited.has(potentialDescendantId)) return false;
    visited.add(potentialDescendantId);

    const descendant = memberMap.get(potentialDescendantId);
    if (!descendant) return false;

    const parentIds = [
      descendant.parents.paternalParent,
      descendant.parents.maternalParent,
    ].filter(Boolean) as string[];

    if (parentIds.includes(potentialAncestorId)) return true;

    return parentIds.some((parentId) =>
      isDescendant(potentialAncestorId, parentId, visited),
    );
  };

  const addMemberEdge = useCallback(
    (edge: Connection) => {
      if (edges.find((e) => e.id === createEdgeId(edge.source, edge.target)))
        throw new Error(`Edge already exists`);

      const sourceMember = memberMap.get(edge.source);
      if (!sourceMember) throw new Error("Source member not found");

      const targetMember = memberMap.get(edge.target);
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

      // Check for cycles: if we are adding Parent -> Child (edge.source -> edge.target),
      // we must ensure that 'edge.source' is not already a descendant of 'edge.target'.
      if (isDescendant(edge.target, edge.source)) {
        throw new Error("Cycle detected: Cannot add ancestor as child");
      }

      const { paternalParent, maternalParent } = targetMember.parents;

      if (paternalParent === edge.source || maternalParent === edge.source) {
        throw new Error("This parent is already linked to the child");
      }
      if (paternalParent && maternalParent) {
        throw new Error("Both parent slots are full");
      }

      // Prefer the slot matching the parent's gender, but never evict an
      // existing parent: fall back to whichever slot is still free.
      const wantsPaternal = sourceMember.gender === "m";
      const wantsMaternal = sourceMember.gender === "f";

      if (wantsPaternal && !paternalParent) {
        void updateMemberPartial(edge.target, {
          paternalParentId: edge.source,
        });
      } else if (wantsMaternal && !maternalParent) {
        void updateMemberPartial(edge.target, {
          maternalParentId: edge.source,
        });
      } else if (!paternalParent) {
        void updateMemberPartial(edge.target, {
          paternalParentId: edge.source,
        });
      } else {
        void updateMemberPartial(edge.target, {
          maternalParentId: edge.source,
        });
      }
    },
    [edges, memberMap, updateMemberPartial, setNewRelation],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        ...params,
        id: createEdgeId(params.source, params.target),
      } as Edge;
      try {
        addMemberEdge(newEdge as Connection);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        console.error(errorMessage);
        toast.error(t("toast-error-database-create"));
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

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
    onSelectionChange,
    debouncedSave,
    pendingUpdates,
  };
};
