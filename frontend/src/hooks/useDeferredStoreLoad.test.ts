import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDeferredStoreLoad } from "./useDeferredStoreLoad";
import { useTreeStore } from "./useTreeStore";
import { Tree } from "@/types/tree";

const TREE: Tree = { id: "tree-123", name: "Test Tree", role: "owner" };

beforeEach(() => {
  vi.clearAllMocks();
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useDeferredStoreLoad", () => {
  it("calls refresh with selectedTree.id when not initialized and tree is selected", () => {
    useTreeStore.setState({ selectedTree: TREE });
    const refresh = vi.fn();

    renderHook(() => useDeferredStoreLoad(false, refresh));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(TREE.id);
  });

  it("does NOT call refresh when already initialized", () => {
    useTreeStore.setState({ selectedTree: TREE });
    const refresh = vi.fn();

    renderHook(() => useDeferredStoreLoad(true, refresh));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does NOT call refresh when no selectedTree", () => {
    useTreeStore.setState({ selectedTree: undefined });
    const refresh = vi.fn();

    renderHook(() => useDeferredStoreLoad(false, refresh));

    expect(refresh).not.toHaveBeenCalled();
  });
});
