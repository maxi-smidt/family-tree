import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { Database, InspectDatabaseResult } from "@/types/database";
import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EXTENSION } from "@/constants";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
import { save, open } from "@tauri-apps/plugin-dialog";

export const useDatabaseManager = () => {
  const removeDatabaseFromSettings = useFamilyTreeSettings(
    (s) => s.removeDatabase,
  );
  const addDatabaseToSettings = useFamilyTreeSettings((s) => s.addDatabase);
  const disconnectDatabase = useDatabaseStore((s) => s.disconnect);
  const connectDatabase = useDatabaseStore((s) => s.connect);
  const databases = useFamilyTreeSettings((s) => s.databases);

  const removeDatabase = useCallback(
    async (database: Database) => {
      try {
        await disconnectDatabase();

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
    async (database: Database, password?: string) => {
      let exportFailed = false;
      try {
        const savePath = await save({
          filters: [{ name: "Database", extensions: [EXTENSION] }],
          defaultPath: `${database.name}.${EXTENSION}`,
        });
        if (!savePath) return;

        await disconnectDatabase();

        try {
          await invoke("export_database", {
            id: database.id,
            targetPath: savePath,
            password: password || null,
          });
        } catch (error) {
          // If export fails, attempt to reconnect the database
          exportFailed = true;
          console.error("Export failed:", error);
          await connectDatabase(database);
        }

        if (!exportFailed) {
          await connectDatabase(database);
        }
      } catch (error) {
        console.error("Export process failed:", error);
        // Ensure we're connected again if possible
        try {
          await connectDatabase(database);
        } catch (reconnectError) {
          console.error(
            "Failed to reconnect after export failure:",
            reconnectError,
          );
        }
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

    const meta = await invoke<InspectDatabaseResult>("inspect_database", {
      sourcePath,
    });

    const collision = meta.id
      ? databases.find((db) => db.id === meta.id)
      : undefined;

    return { collision, sourcePath, meta };
  }, [databases]);

  const inspectDatabaseWithPassword = useCallback(
    async (sourcePath: string, password: string) => {
      const meta = await invoke<InspectDatabaseResult>(
        "inspect_database_with_password",
        {
          sourcePath,
          password,
        },
      );

      const collision = meta.id
        ? databases.find((db) => db.id === meta.id)
        : undefined;

      return { collision, sourcePath, meta };
    },
    [databases],
  );

  const importDatabase = useCallback(
    async (sourcePath: string, overwrite: boolean, password?: string) => {
      const result = await invoke<Database>("import_database", {
        sourcePath,
        overwrite,
        password: password || null,
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
    inspectDatabaseWithPassword,
    importDatabase,
  };
};
