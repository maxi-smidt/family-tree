import { useEffect, useRef, useState } from "react";
import { Member, RelationType } from "@/types/member";
import { useTreeStore } from "@/hooks/useTreeStore";
import { treeProcessorClient, DeriveResult } from "@/workers/treeProcessorClient";
import type { WorkerUnionInfo, WorkerEdge } from "@/workers/treeProcessor.types";

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

export function useDerivedFlowView(
  members: Member[],
  visibleRelationTypes: RelationType[],
  edgeType: string,
): DerivedFlowView {
  const treeId = useTreeStore((s) => s.selectedTree?.id);
  const [state, setState] = useState<DerivedFlowView>(INITIAL_STATE);

  // Track the latest reqId so stale worker responses are discarded.
  const latestReqIdRef = useRef<number>(0);
  // Track the last treeId to detect tree switches and reset stale state.
  const lastTreeIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!treeId) {
      setState(INITIAL_STATE);
      latestReqIdRef.current++;
      return;
    }

    if (treeId !== lastTreeIdRef.current) {
      // Tree switched — clear stale state immediately so the previous tree's
      // unions/edges are not briefly displayed with the new tree's nodes.
      setState(INITIAL_STATE);
      lastTreeIdRef.current = treeId;
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
      treeId,
      members,
      visibleRelationTypes,
      edgeType,
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
  }, [treeId, members, visibleRelationTypes, edgeType]);

  return state;
}
