import { useCallback } from "react";
import { Tree } from "@/types/tree";
import {
  InspectImportResult,
  TreeFileService,
} from "@/services/TreeFileService";
import { useJobStore } from "@/hooks/useJobStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { api } from "@/services/api";

/** Opens the browser file picker and resolves with the chosen file (or null). */
export function pickFile(accept = ".treedb"): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // If the dialog is dismissed no change fires; that simply never resolves,
    // which is fine because the surrounding flow is user-initiated.
    input.click();
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const useTreeManager = () => {
  const deleteTree = useTreeStore((s) => s.deleteTree);
  const selectTree = useTreeStore((s) => s.selectTree);
  const loadTrees = useTreeStore((s) => s.loadTrees);

  const removeDatabase = useCallback(
    async (tree: Tree) => {
      await deleteTree(tree);
    },
    [deleteTree],
  );

  const exportDatabase = useCallback(async (tree: Tree, password?: string) => {
    const blob = await TreeFileService.exportDatabase(tree.id, password);
    triggerDownload(blob, `${tree.name || "family-tree"}.treedb`);
  }, []);

  const inspectImport = useCallback(
    async (file: File): Promise<InspectImportResult> =>
      TreeFileService.inspectImport(file),
    [],
  );

  const importDatabase = useCallback(
    async (file: File, password?: string, name?: string) => {
      const { job_id } = await TreeFileService.importDatabase(
        file,
        password,
        name,
      );
      const treeId = await useJobStore.getState().trackJob(job_id);
      const tree = await api.get<Tree>(`/trees/${treeId}`);
      await loadTrees();
      await selectTree(tree);
      return tree;
    },
    [loadTrees, selectTree],
  );

  const exportGedcom = useCallback(async (tree: Tree) => {
    const blob = await TreeFileService.exportGedcom(tree.id);
    triggerDownload(blob, `${tree.name || "family-tree"}.ged`);
  }, []);

  const importGedcom = useCallback(
    async (file: File, name?: string) => {
      const { job_id } = await TreeFileService.importGedcom(file, name);
      const treeId = await useJobStore.getState().trackJob(job_id);
      const tree = await api.get<Tree>(`/trees/${treeId}`);
      await loadTrees();
      await selectTree(tree);
      // GEDCOM members all start at (0, 0) — auto-layout so they're visible.
      await useMemberStore.getState().updateLayout();
      return tree;
    },
    [loadTrees, selectTree],
  );

  return {
    removeDatabase,
    exportDatabase,
    inspectImport,
    importDatabase,
    exportGedcom,
    importGedcom,
  };
};
