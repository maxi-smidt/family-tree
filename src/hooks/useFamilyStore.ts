import { create } from "zustand";
import {
  mapMemberToDB,
  mapMemberFromDB,
  Member,
  MemberDB,
  MemberUpdate,
} from "../types/member";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { DATABASE_DIRECTORY, EXTENSION } from "../../constants.json";
import { Database as DatabaseType } from "@/types/database";
import Database from "@tauri-apps/plugin-sql";
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs";

interface DatabaseMetaData {
  id?: string;
  name?: string;
  fileName?: string;
  createdAt?: string;
  lastOpened?: string;
  appVersion?: string;
}

interface FamilyState {
  members: Member[];
  metadata: DatabaseMetaData;
  isReady: boolean;
  db: Database | null;

  connect: (database: DatabaseType) => Promise<void>;
  disconnect: (database: DatabaseType) => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshMetadata: (db: Database) => Promise<void>;
  addMember: (member: Member) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberPartial: (id: string, changes: MemberUpdate) => Promise<void>;
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  members: [],
  metadata: {},
  isReady: false,
  db: null,

  disconnect: async () => {
    const { db } = get();
    if (db) {
      await db.close();
      set({
        db: null,
        isReady: false,
        members: [],
        metadata: {},
      });
    }
  },

  connect: async (database: DatabaseType) => {
    set({
      isReady: false,
      metadata: {},
      members: [],
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

    const connectionString = `sqlite:${fullPath}`;
    const dbInstance = await Database.load(connectionString);
    await dbInstance.execute(`
      CREATE TABLE IF NOT EXISTS members (
          id TEXT PRIMARY KEY,
          firstName TEXT,
          lastName TEXT,
          imageData TEXT,
          dateOfBirth TEXT,
          dateOfDeath TEXT,
          firstParentId TEXT,
          secondParentId TEXT,
          additionalData TEXT,
          isCollapsed BOOLEAN DEFAULT FALSE,
          positionX REAL,
          positionY REAL
      )
    `);

    await dbInstance.execute(`
      CREATE TABLE IF NOT EXISTS db_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    const metaCheck = await dbInstance.select<{ value: string }[]>(
      "SELECT value FROM db_metadata WHERE key = $1",
      ["createdAt"],
    );

    const now = new Date().toISOString();
    if (metaCheck.length === 0) {
      await dbInstance.execute(
        "INSERT INTO db_metadata (key, value) VALUES ($1, $2)",
        ["id", database.id],
      );
      await dbInstance.execute(
        "INSERT INTO db_metadata (key, value) VALUES ($1, $2)",
        ["createdAt", now],
      );
      await dbInstance.execute(
        "INSERT INTO db_metadata (key, value) VALUES ($1, $2)",
        ["name", database.name],
      );
    }

    await dbInstance.execute(
      "INSERT OR REPLACE INTO db_metadata (key, value) VALUES ($1, $2)",
      ["lastOpened", now],
    );

    set({ db: dbInstance });

    await Promise.all([
      get().refreshMembers(),
      get().refreshMetadata(dbInstance),
    ]);

    set({ isReady: true });
  },

  refreshMetadata: async (db: Database) => {
    const rows = await db.select<{ key: string; value: string }[]>(
      "SELECT * FROM db_metadata",
    );

    const metaObj: any = {};
    rows.forEach((row) => {
      metaObj[row.key] = row.value;
    });

    set({ metadata: metaObj });
  },

  refreshMembers: async () => {
    const db = get().db;
    if (!db) return;

    const result = await db.select<MemberDB[]>("SELECT * FROM members");
    const appMembers = result.map(mapMemberFromDB);

    set({ members: appMembers });
  },

  addMember: async (newMember: Member) => {
    const db = get().db;
    if (!db) return;

    const row = mapMemberToDB(newMember);
    await db.execute(
      `INSERT INTO members (
          id, firstName, lastName, imageData, dateOfBirth, dateOfDeath,
          firstParentId, secondParentId, additionalData, positionX, positionY
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        row.firstName,
        row.lastName,
        row.imageData,
        row.dateOfBirth,
        row.dateOfDeath,
        row.firstParentId,
        row.secondParentId,
        row.additionalData,
        row.positionX,
        row.positionY,
      ],
    );
    await get().refreshMembers();
  },

  removeMember: async (memberId: string) => {
    const db = get().db;
    if (!db) return;
    await db.execute(`DELETE FROM members WHERE id = $1`, [memberId]);
    await get().refreshMembers();
  },

  updateMemberPartial: async (id: string, changes: MemberUpdate) => {
    const db = get().db;
    if (!db) return;

    const entries = Object.entries(changes);
    if (entries.length === 0) return;

    const keys = entries.map(([key]) => key);

    const values = entries.map(([, value]) => {
      if (typeof value === "boolean") {
        return value ? 1 : 0;
      }
      return value;
    });

    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
    await db.execute(`UPDATE members SET ${setClause} WHERE id = $1`, [
      id,
      ...values,
    ]);

    await get().refreshMembers();
  },
}));
