import { useCallback } from "react";
import { Database as Tree } from "@/types/database";
import { api } from "@/services/api";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";

interface InspectResult {
  password_required: boolean;
  name: string | null;
}

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

export const useDatabaseManager = () => {
  const deleteDatabase = useDatabaseStore((s) => s.deleteDatabase);
  const selectDatabase = useDatabaseStore((s) => s.selectDatabase);
  const loadTrees = useDatabaseStore((s) => s.loadTrees);

  const removeDatabase = useCallback(
    async (tree: Tree) => {
      await deleteDatabase(tree);
    },
    [deleteDatabase],
  );

  const exportDatabase = useCallback(async (tree: Tree, password?: string) => {
    const response = await api.getRaw(
      `/trees/${tree.id}/export`,
      password ? { password } : undefined,
    );
    const blob = await response.blob();
    triggerDownload(blob, `${tree.name || "family-tree"}.treedb`);
  }, []);

  const inspectImport = useCallback(
    async (file: File): Promise<InspectResult> => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<InspectResult>("/trees/import/inspect", form);
    },
    [],
  );

  const importDatabase = useCallback(
    async (file: File, password?: string, name?: string) => {
      const form = new FormData();
      form.append("file", file);
      if (password) form.append("password", password);
      if (name) form.append("name", name);
      const tree = await api.postForm<Tree>("/trees/import", form);
      await loadTrees();
      await selectDatabase(tree);
      return tree;
    },
    [loadTrees, selectDatabase],
  );

  return {
    removeDatabase,
    exportDatabase,
    inspectImport,
    importDatabase,
  };
};
