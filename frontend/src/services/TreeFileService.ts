import { api } from "@/services/api";

export interface InspectImportResult {
  password_required: boolean;
  name: string | null;
  app_version: string | null;
  exported_at: string | null;
  bundle_version: number | null;
}

export interface JobStarted {
  job_id: string;
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
    const response = await api.postRaw(`/trees/${treeId}/export`, {
      password: password || null,
    });
    return response.blob();
  },

  inspectImport(file: File): Promise<InspectImportResult> {
    return api.postForm<InspectImportResult>(
      "/trees/import/inspect",
      importForm(file, {}),
    );
  },

  importDatabase(
    file: File,
    password?: string,
    name?: string,
  ): Promise<JobStarted> {
    return api.postForm<JobStarted>(
      "/trees/import",
      importForm(file, { password, name }),
    );
  },

  async exportGedcom(treeId: string): Promise<Blob> {
    const response = await api.getRaw(`/trees/${treeId}/export-gedcom`);
    return response.blob();
  },

  importGedcom(file: File, name?: string): Promise<JobStarted> {
    return api.postForm<JobStarted>(
      "/trees/import-gedcom",
      importForm(file, { name }),
    );
  },
};
