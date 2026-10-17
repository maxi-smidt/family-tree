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
import type { WorkerUnionInfo } from "@/workers/treeProcessor.types";
import debounce from "lodash.debounce";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const useFlowInteractions = (
  members: Member[],
  edges: Edge[],
  unions: WorkerUnionInfo[],
  setNodes: Dispatch<SetStateAction<Node[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
  setMembersToDelete: Dispatch<SetStateAction<Member[]>>,
  setSelectedNodes: Dispatch<SetStateAction<Node[]>>,
  setNewRelation: Dispatch<SetStateAction<Connection | null>>,
) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "hooks.flow-interactions",
  });
  const {
    removeRelationBidirectional,
    updateMemberPartial,
    persistPositions,
    runHistoryGroup,
    undoEntry,
  } = useMemberStore();
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

  // Clear `parentId` from whichever parent slot of `childId` it fills.
  const detachParent = useCallback(
    async (childId: string, parentId: string) => {
      const child = memberMap.get(childId);
      if (!child) return;
      if (child.parents.paternalParent === parentId) {
        await updateMemberPartial(childId, { paternalParentId: null });
      } else if (child.parents.maternalParent === parentId) {
        await updateMemberPartial(childId, { maternalParentId: null });
      }
    },
    [memberMap, updateMemberPartial],
  );

  const removeMemberEdge = useCallback(
    async (change: EdgeRemoveChange) => {
      // Couple relations and two-parent child links are drawn through a union
      // node, so their edge ids are "ue:<unionId>:left|right" (the couple) or
      // "ue:<unionId>:child:<childId>" (a shared child). The union/member ids
      // can't be split out of the id reliably (UUIDs contain "-"), so resolve
      // the couple via the union list and read the child id directly.
      if (change.id.startsWith("ue:")) {
        const parts = change.id.split(":");
        if (parts[2] === "child") {
          const childId = parts[3];
          if (childId) {
            // The child's parents are exactly this couple, so detaching from
            // the union clears both parent slots.
            await updateMemberPartial(childId, {
              paternalParentId: null,
              maternalParentId: null,
            });
          }
          return;
        }

        // A partner's line into the union dot: that partner leaves the union.
        // The couple relation goes, and they stop being a parent of the
        // shared children — the other partner stays linked to each child.
        const union = unions.find((u) => u.id === parts[1]);
        if (!union) return;
        const edge = edges.find((e) => e.id === change.id);
        const partnerId =
          parts[2] === "left"
            ? edge?.source
            : parts[2] === "right"
              ? edge?.target
              : undefined;
        if (union.relationType) {
          await removeRelationBidirectional(
            union.partner1Id,
            union.partner2Id,
            union.relationType as RelationType,
          );
        }
        if (partnerId) {
          for (const childId of union.childIds) {
            await detachParent(childId, partnerId);
          }
        }
        return;
      }

      // Non-couple relations (e.g. sibling): "rel:<idA-idB>:<type>". The member
      // ids aren't recoverable from the id, so read them off the edge; the type
      // is everything after the pair key's trailing ":".
      if (change.id.startsWith("rel:")) {
        const edge = edges.find((e) => e.id === change.id);
        if (!edge) return;
        const rest = change.id.slice("rel:".length);
        const sep = rest.indexOf(":");
        if (sep === -1) return;
        const type = rest.slice(sep + 1) as RelationType;
        await removeRelationBidirectional(edge.source, edge.target, type);
        return;
      }

      // Single-parent link: "e:<parentId>:<childId>" (UUIDs have no ":").
      const parts = change.id.split(":");
      const source = parts[1];
      const target = parts[2];
      if (!source || !target) return;
      await detachParent(target, source);
    },
    [
      edges,
      unions,
      removeRelationBidirectional,
      updateMemberPartial,
      detachParent,
    ],
  );

  const removeMemberEdges = useCallback(
    async (changes: EdgeRemoveChange[]) => {
      try {
        // One keypress is one undo step, however many records it touched.
        const entry = await runHistoryGroup(async () => {
          for (const change of changes) await removeMemberEdge(change);
        });
        if (entry) {
          toast.success(t("toast-edge-removed", { count: changes.length }), {
            action: {
              label: t("undo"),
              onClick: () => void undoEntry(entry),
            },
          });
        }
      } catch {
        toast.error(t("toast-error-edge-remove"));
      }
    },
    [removeMemberEdge, runHistoryGroup, undoEntry, t],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removeChanges = changes.filter(
        (c): c is EdgeRemoveChange => c.type === "remove",
      );
      if (removeChanges.length > 0) void removeMemberEdges(removeChanges);
      setEdges((edgeSnapshot) => applyEdgeChanges(changes, edgeSnapshot));
    },
    [removeMemberEdges, setEdges],
  );

  // Deleting a member drags its connected edges along with it, but the member
  // deletion has its own confirmation and cleanup. Only edges the user picked
  // themselves become relationship removals.
  const onBeforeDelete = useCallback(
    async ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) =>
      nodes.length === 0
        ? true
        : { nodes, edges: edges.filter((e) => e.selected) },
    [],
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

  const addUnionChildEdge = useCallback(
    (params: Connection) => {
      const union = unions.find((u) => u.id === params.source);
      if (!union) throw new Error("Union not found");

      const child = memberMap.get(params.target);
      if (!child) throw new Error("Target member not found");

      if (
        params.target === union.partner1Id ||
        params.target === union.partner2Id
      ) {
        throw new Error("Cannot add a partner as their own child");
      }

      if (child.parents.paternalParent || child.parents.maternalParent) {
        throw new Error("Child already has a parent");
      }

      if (
        isDescendant(params.target, union.partner1Id) ||
        isDescendant(params.target, union.partner2Id)
      ) {
        throw new Error("Cycle detected: Cannot add ancestor as child");
      }

      const partner1 = memberMap.get(union.partner1Id);
      const partner2 = memberMap.get(union.partner2Id);

      let paternalParentId = union.partner1Id;
      let maternalParentId = union.partner2Id;

      if (partner1?.gender === "m" || partner2?.gender === "f") {
        paternalParentId = union.partner1Id;
        maternalParentId = union.partner2Id;
      } else if (partner1?.gender === "f" || partner2?.gender === "m") {
        paternalParentId = union.partner2Id;
        maternalParentId = union.partner1Id;
      }

      void updateMemberPartial(params.target, {
        paternalParentId,
        maternalParentId,
      });
    },
    [unions, memberMap, updateMemberPartial],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      try {
        if (params.source.startsWith("union-")) {
          addUnionChildEdge(params);
          return;
        }

        const newEdge = {
          ...params,
          id: createEdgeId(params.source, params.target),
        } as Edge;
        addMemberEdge(newEdge as Connection);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        console.error(errorMessage);
        toast.error(t("toast-error-database-create"));
      }
    },
    [addMemberEdge, addUnionChildEdge],
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
    onBeforeDelete,
    onConnect,
    onSelectionChange,
    debouncedSave,
    pendingUpdates,
  };
};
