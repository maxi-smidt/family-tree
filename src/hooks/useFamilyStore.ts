import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";
import {
  mapMemberToDB,
  mapMemberFromDB,
  Member,
  MemberDB,
  MemberUpdate,
} from "../types/member.ts";

const DB_PATH = "sqlite:family_tree_v1.db";

interface FamilyState {
  members: Member[];
  isReady: boolean;
  db: Database | null;

  init: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  addMember: (member: Member) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberPartial: (id: string, changes: MemberUpdate) => Promise<void>;
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  members: [],
  isReady: false,
  db: null,

  init: async () => {
    if (get().isReady) return;

    const dbInstance = await Database.load(DB_PATH);
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
          positionX REAL,
          positionY REAL
      )
    `);

    set({ db: dbInstance, isReady: true });

    await get().refreshMembers();
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

    const keys = Object.keys(changes);
    if (keys.length === 0) return;

    const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
    const values = [id, ...Object.values(changes)];

    await db.execute(`UPDATE members SET ${setClause} WHERE id = $1`, values);

    await get().refreshMembers();
  },
}));
