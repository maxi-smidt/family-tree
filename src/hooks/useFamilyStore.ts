import { create } from "zustand";
import {
  mapMemberToDB,
  mapMemberFromDB,
  Member,
  MemberDB,
  MemberUpdate,
} from "@/types/member";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { DATABASE_DIRECTORY, EXTENSION } from "../../constants.json";
import { Database as DatabaseType } from "@/types/database";
import Database from "@tauri-apps/plugin-sql";
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs";
import { getLayoutedElements } from "@/utils/layoutUtils";
import { GalleryImage, GalleryImageDB } from "@/types/gallery";
import { runMigrations } from "@/utils/db-migration";

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
  galleryImages: GalleryImage[];
  metadata: DatabaseMetaData;
  isReady: boolean;
  db: Database | null;

  connect: (database: DatabaseType) => Promise<void>;
  disconnect: (database: DatabaseType) => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshGalleryImages: () => Promise<void>;
  refreshMetadata: (db: Database) => Promise<void>;
  addMember: (member: Member) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  updateMemberPartial: (id: string, changes: MemberUpdate) => Promise<void>;
  updateLayout: () => Promise<void>;
  addGalleryImage: (
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
  ) => Promise<void>;
  updateGalleryImage: (
    id: string,
    changes: Partial<GalleryImage>,
  ) => Promise<void>;
  removeGalleryImage: (id: string) => Promise<void>;
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  members: [],
  galleryImages: [],
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
        galleryImages: [],
        metadata: {},
      });
    }
  },

  connect: async (database: DatabaseType) => {
    set({
      isReady: false,
      metadata: {},
      members: [],
      galleryImages: [],
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

    await runMigrations(dbInstance);

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
      get().refreshGalleryImages(),
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

  refreshGalleryImages: async () => {
    const db = get().db;
    if (!db) return;

    const imagesResult = await db.select<GalleryImageDB[]>(
      "SELECT * FROM gallery_images",
    );
    const linksResult = await db.select<
      { gallery_image_id: string; member_id: string }[]
    >("SELECT * FROM gallery_member_link");

    const images = imagesResult.map((row) => {
      const linkedMemberIds = linksResult
        .filter((link) => link.gallery_image_id === row.id)
        .map((link) => link.member_id);
      return {
        ...row,
        linkedMemberIds,
      };
    });

    set({ galleryImages: images });
  },

  addMember: async (newMember: Member) => {
    const db = get().db;
    if (!db) return;

    const row = mapMemberToDB(newMember);
    await db.execute(
      `INSERT INTO members (
          id, gender, firstName, lastName, maidenName, imageData, dateOfBirth, dateOfDeath,
          paternalParentId, maternalParentId, additionalData, positionX, positionY
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.id,
        row.gender,
        row.firstName,
        row.lastName,
        row.maidenName,
        row.imageData,
        row.dateOfBirth,
        row.dateOfDeath,
        row.paternalParentId,
        row.maternalParentId,
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
      if (value === undefined) {
        return null;
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

  updateLayout: async () => {
    const { db, members, refreshMembers } = get();
    if (!db) return;

    const newPositions = getLayoutedElements(members);

    const updatePromises = Object.entries(newPositions).map(([id, pos]) => {
      return db.execute(
        "UPDATE members SET positionX = $1, positionY = $2 WHERE id = $3",
        [pos.x, pos.y, id],
      );
    });

    await Promise.all(updatePromises);

    await refreshMembers();
  },

  addGalleryImage: async (
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
  ) => {
    const db = get().db;
    if (!db) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO gallery_images (id, imageData, title, description, createdAt, uploadedAt) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, image.imageData, image.title, image.description, now, now],
    );

    if (image.linkedMemberIds && image.linkedMemberIds.length > 0) {
      for (const memberId of image.linkedMemberIds) {
        await db.execute(
          "INSERT INTO gallery_member_link (gallery_image_id, member_id) VALUES ($1, $2)",
          [id, memberId],
        );
      }
    }

    await get().refreshGalleryImages();
  },

  updateGalleryImage: async (id: string, changes: Partial<GalleryImage>) => {
    const db = get().db;
    if (!db) return;

    const { linkedMemberIds, ...otherChanges } = changes;

    const entries = Object.entries(otherChanges).filter(
      ([key]) => key !== "id" && key !== "uploadedAt",
    );

    if (entries.length > 0) {
      const keys = entries.map(([key]) => key);
      const values = entries.map(([, value]) => value);
      const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(", ");
      await db.execute(`UPDATE gallery_images SET ${setClause} WHERE id = $1`, [
        id,
        ...values,
      ]);
    }

    if (linkedMemberIds) {
      await db.execute(
        "DELETE FROM gallery_member_link WHERE gallery_image_id = $1",
        [id],
      );
      for (const memberId of linkedMemberIds) {
        await db.execute(
          "INSERT INTO gallery_member_link (gallery_image_id, member_id) VALUES ($1, $2)",
          [id, memberId],
        );
      }
    }

    await get().refreshGalleryImages();
  },

  removeGalleryImage: async (id: string) => {
    const db = get().db;
    if (!db) return;
    await db.execute("DELETE FROM gallery_images WHERE id = $1", [id]);
    await get().refreshGalleryImages();
  },
}));
