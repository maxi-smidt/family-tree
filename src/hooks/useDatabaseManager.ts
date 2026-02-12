import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { Database } from "@/types/database";
import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EXTENSION } from "@/constants";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { save, open } from "@tauri-apps/plugin-dialog";

export const useDatabaseManager = () => {
  const removeDatabaseFromSettings = useFamilyTreeSettings(
    (s) => s.removeDatabase,
  );
  const addDatabaseToSettings = useFamilyTreeSettings((s) => s.addDatabase);
  const disconnectDatabase = useFamilyStore((s) => s.disconnect);
  const connectDatabase = useFamilyStore((s) => s.connect);
  const databases = useFamilyTreeSettings((s) => s.databases);

  const removeDatabase = useCallback(
    async (database: Database) => {
      try {
        await disconnectDatabase(database);

        await invoke<number>("delete_database", {
          id: database.id,
        });

        removeDatabaseFromSettings(database);
      } catch (e) {
        console.error(e);
      }
    },
    [removeDatabaseFromSettings],
  );

  const exportDatabase = useCallback(
    async (database: Database) => {
      try {
        const savePath = await save({
          filters: [{ name: "Database", extensions: [EXTENSION] }],
          defaultPath: `${database.name}.${EXTENSION}`,
        });
        if (!savePath) return;

        await disconnectDatabase(database);

        await invoke("export_database", {
          id: database.id,
          targetPath: savePath,
        });

        await connectDatabase(database);
      } catch (error) {
        console.error("Export failed:", error);
      }
    },
    [disconnectDatabase, connectDatabase],
  );

  const importDatabaseCheck = useCallback(async () => {
    const sourcePath = await open({
      multiple: false,
      filters: [{ name: "Database", extensions: [EXTENSION] }],
    });

    if (!sourcePath || Array.isArray(sourcePath)) return;

    const meta = await invoke<{ id: string; name: string }>(
      "inspect_database",
      { sourcePath },
    );

    const collision = databases.find((db) => db.id === meta.id);

    return { collision, sourcePath };
  }, [databases]);

  const importDatabase = useCallback(
    async (sourcePath: string, overwrite: boolean) => {
      const result = await invoke<Database>("import_database", {
        sourcePath,
        overwrite,
      });
      addDatabaseToSettings(result);
      return result;
    },
    [addDatabaseToSettings],
  );

  return {
    removeDatabase,
    exportDatabase,
    importDatabaseCheck,
    importDatabase,
  };
};
