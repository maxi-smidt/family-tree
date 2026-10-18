import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { canEditArea } from "@/utils/accessLevels";

/** Citing a document needs Edit on Documents and on the tree (the person);
 *  the backend checks the document's and person's sections too. */
export function useCanEditEvidence(): boolean {
  return useWorkspaceStore(
    (s) =>
      canEditArea(s.selectedTree, "sources") &&
      canEditArea(s.selectedTree, "tree"),
  );
}
