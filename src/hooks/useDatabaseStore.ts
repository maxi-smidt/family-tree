import { create } from "zustand";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { DATABASE_DIRECTORY, EXTENSION } from "@/constants";
import { Database as DatabaseType } from "@/types/database";
import Database from "@tauri-apps/plugin-sql";
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs";
import { DatabaseService } from "@/services/DatabaseService";
import { invoke } from "@tauri-apps/api/core";
import { RelationType } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";

interface DatabaseMetaData {
  id?: string;
  name?: string;
  fileName?: string;
  createdAt?: string;
  lastOpened?: string;
  appVersion?: string;
}

interface DatabaseState {
  metadata: DatabaseMetaData;
  relationTypes: { id: RelationType }[];
  isReady: boolean;
  db: Database | null;

  connect: (database: DatabaseType) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshMetadata: (db: Database) => Promise<void>;
  refreshRelationTypes: () => Promise<void>;
  addRelationType: (id: string, description: string) => Promise<void>;
}

export const useDatabaseStore = create<DatabaseState>((set, get) => ({
  metadata: {},
  relationTypes: [],
  isReady: false,
  db: null,

  disconnect: async () => {
    const { db } = get();
    if (db) {
      await db.close();
      set({
        db: null,
        isReady: false,
        metadata: {},
        relationTypes: [],
      });
      // Clear other stores
      await useMemberStore.getState().refreshMembers();
      await useGalleryStore.getState().refreshGalleryImages();
    }
  },

  connect: async (database: DatabaseType) => {
    set({
      isReady: false,
      metadata: {},
      relationTypes: [],
      db: null,
    });

    const appConfigPath = await appConfigDir();

    const fullPath = await join(
      appConfigPath,
      DATABASE_DIRECTORY,
      `${database.id}.${EXTENSION}`,
    );

    const dirExists = await exists(DATABASE_DIRECTORY, {
      baseDir: BaseDirectory.AppConfig,
    });
    if (!dirExists) {
      await mkdir(DATABASE_DIRECTORY, {
        baseDir: BaseDirectory.AppConfig,
        recursive: true,
      });
    }

    await invoke("initialize_database", { id: database.id });

    const connectionString = `sqlite:${fullPath}`;
    const dbInstance = await Database.load(connectionString);

    const metaCheck = await DatabaseService.checkMetadataKey(
      dbInstance,
      "createdAt",
    );

    const now = new Date().toISOString();
    if (metaCheck.length === 0) {
      await DatabaseService.initMetadata(
        dbInstance,
        database.id,
        database.name,
        now,
      );
    }

    await DatabaseService.updateLastOpened(dbInstance, now);

    set({ db: dbInstance });

    await Promise.all([
      get().refreshMetadata(dbInstance),
      get().refreshRelationTypes(),
      useMemberStore.getState().refreshMembers(),
      useGalleryStore.getState().refreshGalleryImages(),
    ]);

    set({ isReady: true });
  },

  refreshMetadata: async (db: Database) => {
    const metaObj = await DatabaseService.getMetadata(db);
    set({ metadata: metaObj });
  },

  refreshRelationTypes: async () => {
    const db = get().db;
    if (!db) return;
    const types = await DatabaseService.getRelationTypes(db);
    set({ relationTypes: types });
  },

  addRelationType: async (id: string, description: string) => {
    const db = get().db;
    if (!db) return;
    await DatabaseService.addRelationType(db, id, description);
    await get().refreshRelationTypes();
  },
}));
