import { useEffect } from "react";
import { useTreeStore } from "@/hooks/useTreeStore";

export function useDeferredStoreLoad(
  initialized: boolean,
  refresh: (treeId: string) => void | Promise<void>,
): void {
  const selectedTree = useTreeStore((s) => s.selectedTree);
  useEffect(() => {
    if (!initialized && selectedTree) void refresh(selectedTree.id);
  }, [initialized, selectedTree, refresh]);
}
