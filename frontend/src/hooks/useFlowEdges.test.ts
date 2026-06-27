import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFlowEdges } from "./useFlowEdges";
import type { WorkerEdge } from "@/workers/treeProcessor.types";

function edge(id: string, source: string, target: string): WorkerEdge {
  return {
    id,
    source,
    target,
    baseStyle: {},
    _highlightPairs: [],
  };
}

const edges: WorkerEdge[] = [
  edge("a-b", "a", "b"),
  edge("b-c", "b", "c"),
  edge("ue:u1:child:c", "u1", "c"),
];

describe("useFlowEdges", () => {
  it("does not hide edges when nothing is collapsed", () => {
    const { result } = renderHook(() => useFlowEdges(edges));
    expect(result.current.every((e) => !e.hidden)).toBe(true);
  });

  it("hides edges whose endpoint is in the hidden set (collapsed descendant)", () => {
    const hidden = new Set(["c", "u1"]);
    const { result } = renderHook(() =>
      useFlowEdges(edges, undefined, hidden),
    );
    const byId = new Map(result.current.map((e) => [e.id, e]));
    // a→b stays visible; both endpoints are visible.
    expect(byId.get("a-b")?.hidden).toBe(false);
    // b→c hidden because c is collapsed away.
    expect(byId.get("b-c")?.hidden).toBe(true);
    // The union→child edge is hidden because both the union dot and child are hidden.
    expect(byId.get("ue:u1:child:c")?.hidden).toBe(true);
  });
});
