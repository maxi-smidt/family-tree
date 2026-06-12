import { api } from "@/services/api";
import { Tree } from "@/types/tree";

export interface InspectImportResult {
  password_required: boolean;
  name: string | null;
}

function importForm(file: File, values: { password?: string; name?: string }) {
  const form = new FormData();
  form.append("file", file);
  if (values.password) form.append("password", values.password);
  if (values.name) form.append("name", values.name);
  return form;
}

export const TreeFileService = {
  async exportDatabase(treeId: string, password?: string): Promise<Blob> {
    const response = await api.getRaw(
      `/trees/${treeId}/export`,
      password ? { password } : undefined,
    );
    return response.blob();
  },

  inspectImport(file: File): Promise<InspectImportResult> {
    return api.postForm<InspectImportResult>(
      "/trees/import/inspect",
      importForm(file, {}),
    );
  },

  importDatabase(file: File, password?: string, name?: string): Promise<Tree> {
    return api.postForm<Tree>(
      "/trees/import",
      importForm(file, { password, name }),
    );
  },

  async exportGedcom(treeId: string): Promise<Blob> {
    const response = await api.getRaw(`/trees/${treeId}/export-gedcom`);
    return response.blob();
  },

  importGedcom(file: File, name?: string): Promise<Tree> {
    return api.postForm<Tree>(
      "/trees/import-gedcom",
      importForm(file, { name }),
    );
  },
};
