import { useEffect, useMemo, useRef, useState } from "react";
import { Member, RelationType, RelationTypeDB } from "@/types/member";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { treeProcessorClient, DeriveResult } from "@/workers/treeProcessorClient";
import type {
  WorkerUnionInfo,
  WorkerEdge,
  RelationStyleMap,
} from "@/workers/treeProcessor.types";

const EMPTY_SET = new Set<string>();

export interface DerivedFlowView {
  unions: WorkerUnionInfo[];
  baseEdges: WorkerEdge[];
  hiddenNodeIds: ReadonlySet<string>;
  isDeriving: boolean;
}

const INITIAL_STATE: DerivedFlowView = {
  unions: [],
  baseEdges: [],
  hiddenNodeIds: EMPTY_SET,
  isDeriving: false,
};

/** Build a stable RelationStyleMap from the registry types that have at least
 *  one non-null style field. We use a JSON-stringified signature as the dep
 *  to avoid reference-equality churn causing an infinite re-derive loop. */
function buildRelationStyleMap(relationTypes: RelationTypeDB[]): RelationStyleMap {
  const map: RelationStyleMap = {};
  for (const rt of relationTypes) {
    if (rt.color != null || rt.stroke_width != null || rt.stroke_dasharray != null) {
      map[rt.id] = {
        color: rt.color ?? null,
        strokeWidth: rt.stroke_width ?? null,
        strokeDasharray: rt.stroke_dasharray ?? null,
      };
    }
  }
  return map;
}

export function useDerivedFlowView(
  members: Member[],
  visibleRelationTypes: RelationType[],
  edgeType: string,
): DerivedFlowView {
  const workspaceId = useWorkspaceStore((s) => s.selectedTree?.id);
  const relationTypes = useWorkspaceStore((s) => s.relationTypes);
  const [state, setState] = useState<DerivedFlowView>(INITIAL_STATE);

  // Track the latest reqId so stale worker responses are discarded.
  const latestReqIdRef = useRef<number>(0);
  // Track the last workspaceId to detect tree switches and reset stale state.
  const lastTreeIdRef = useRef<string | undefined>(undefined);

  // Stable primitive signature for style-relevant fields — avoids
  // object-reference churn that would cause an infinite re-derive loop.
  const styleSignature = useMemo(
    () =>
      JSON.stringify(
        relationTypes
          .filter(
            (rt) =>
              rt.color != null ||
              rt.stroke_width != null ||
              rt.stroke_dasharray != null,
          )
          .map((rt) => [rt.id, rt.color, rt.stroke_width, rt.stroke_dasharray]),
      ),
    [relationTypes],
  );

  const relationStyles = useMemo(
    () => buildRelationStyleMap(relationTypes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [styleSignature],
  );

  useEffect(() => {
    if (!workspaceId) {
      setState(INITIAL_STATE);
      latestReqIdRef.current++;
      return;
    }

    if (workspaceId !== lastTreeIdRef.current) {
      // Workspace switched — clear stale state immediately so the previous tree's
      // unions/edges are not briefly displayed with the new tree's nodes.
      setState(INITIAL_STATE);
      lastTreeIdRef.current = workspaceId;
      latestReqIdRef.current++;
    }

    if (members.length === 0) {
      setState(INITIAL_STATE);
      return;
    }

    // Show a deriving flag only on the initial empty→populated transition so
    // consumers can choose to gate secondary rendering on it.
    setState((prev) => ({
      ...prev,
      isDeriving: prev.unions.length === 0 && prev.baseEdges.length === 0,
    }));

    const { reqId, promise } = treeProcessorClient.deriveView(
      workspaceId,
      members,
      visibleRelationTypes,
      edgeType,
      relationStyles,
    );
    const capturedReqId = reqId;
    latestReqIdRef.current = capturedReqId;

    promise
      .then((data: DeriveResult) => {
        if (capturedReqId !== latestReqIdRef.current) return;
        setState({
          unions: data.unions,
          baseEdges: data.edges,
          hiddenNodeIds: new Set(data.hiddenNodeIds),
          isDeriving: false,
        });
      })
      .catch(() => {
        if (capturedReqId !== latestReqIdRef.current) return;
        setState((prev) => ({ ...prev, isDeriving: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, members, visibleRelationTypes, edgeType, relationStyles]);

  return state;
}
