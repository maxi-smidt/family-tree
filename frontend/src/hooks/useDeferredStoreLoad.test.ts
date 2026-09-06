import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDeferredStoreLoad } from "./useDeferredStoreLoad";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { Workspace } from "@/types/workspace";

const TREE: Workspace = { id: "tree-123", name: "Test Workspace", role: "owner" };

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useDeferredStoreLoad", () => {
  it("calls refresh with selectedTree.id when not initialized and tree is selected", () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    const refresh = vi.fn();

    renderHook(() => useDeferredStoreLoad(false, refresh));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(TREE.id);
  });

  it("does NOT call refresh when already initialized", () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    const refresh = vi.fn();

    renderHook(() => useDeferredStoreLoad(true, refresh));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does NOT call refresh when no selectedTree", () => {
    useWorkspaceStore.setState({ selectedTree: undefined });
    const refresh = vi.fn();

    renderHook(() => useDeferredStoreLoad(false, refresh));

    expect(refresh).not.toHaveBeenCalled();
  });
});
