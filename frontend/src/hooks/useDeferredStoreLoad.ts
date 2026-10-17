import { useEffect } from "react";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";

export function useDeferredStoreLoad(
  initialized: boolean,
  refresh: (workspaceId: string) => void | Promise<void>,
): void {
  const selectedTree = useWorkspaceStore((s) => s.selectedTree);
  useEffect(() => {
    if (!initialized && selectedTree) void refresh(selectedTree.id);
  }, [initialized, selectedTree, refresh]);
}
