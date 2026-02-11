import { create } from "zustand";
import {
  mapMemberToDB,
  mapMemberFromDB,
  Member,
  MemberDB,
  MemberUpdate,
  RelationDB,
  RelationType,
  RelationTypeDefinition,
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
  relationTypes: RelationTypeDefinition[];
  metadata: DatabaseMetaData;
  isReady: boolean;
  db: Database | null;

  connect: (database: DatabaseType) => Promise<void>;
  disconnect: (database: DatabaseType) => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshGalleryImages: () => Promise<void>;
  refreshMetadata: (db: Database) => Promise<void>;
  refreshRelationTypes: () => Promise<void>;
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
  addRelation: (
    fromId: string,
    toId: string,
    type: RelationType,
  ) => Promise<void>;
  removeRelation: (
    fromId: string,
    toId: string,
    type: RelationType,
  ) => Promise<void>;
  addRelationType: (id: string, description: string) => Promise<void>;
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  members: [],
  galleryImages: [],
  relationTypes: [],
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
        relationTypes: [],
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
      get().refreshRelationTypes(),
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

  refreshRelationTypes: async () => {
    const db = get().db;
    if (!db) return;
    const types = await db.select<RelationTypeDefinition[]>(
      "SELECT * FROM relation_types",
    );
    set({ relationTypes: types });
  },

  refreshMembers: async () => {
    const db = get().db;
    if (!db) return;

    const result = await db.select<MemberDB[]>("SELECT * FROM members");
    const relations = await db.select<RelationDB[]>("SELECT * FROM relations");

    const memberGenderMap = new Map<string, string>();
    result.forEach((m) => memberGenderMap.set(m.id, m.gender));

    const appMembers = result.map((member) => {
      const memberRelations = relations.filter(
        (r) => r.from_member_id === member.id,
      );
      const mapped = mapMemberFromDB(member, memberRelations);

      // Reconstruct parents from relations
      mapped.parents = {
        paternalParent: null,
        maternalParent: null,
      };

      memberRelations.forEach((r) => {
        if (r.relation_type === "parent") {
          const parentGender = memberGenderMap.get(r.to_member_id);
          if (parentGender === "male") {
            mapped.parents.paternalParent = r.to_member_id;
          } else if (parentGender === "female") {
            mapped.parents.maternalParent = r.to_member_id;
          } else {
            if (!mapped.parents.paternalParent)
              mapped.parents.paternalParent = r.to_member_id;
            else mapped.parents.maternalParent = r.to_member_id;
          }
        }
      });

      return mapped;
    });

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
          additionalData, positionX, positionY
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        row.gender,
        row.firstName,
        row.lastName,
        row.maidenName,
        row.imageData,
        row.dateOfBirth,
        row.dateOfDeath,
        row.additionalData,
        row.positionX,
        row.positionY,
      ],
    );

    if (newMember.parents.paternalParent) {
      await db.execute(
        "INSERT INTO relations (from_member_id, to_member_id, relation_type) VALUES ($1, $2, $3)",
        [newMember.id, newMember.parents.paternalParent, "parent"],
      );
    }
    if (newMember.parents.maternalParent) {
      await db.execute(
        "INSERT INTO relations (from_member_id, to_member_id, relation_type) VALUES ($1, $2, $3)",
        [newMember.id, newMember.parents.maternalParent, "parent"],
      );
    }

    if (newMember.relations) {
      for (const rel of newMember.relations) {
        if (
          rel.relationType === "parent" &&
          (rel.toMemberId === newMember.parents.paternalParent ||
            rel.toMemberId === newMember.parents.maternalParent)
        ) {
          continue;
        }
        await db.execute(
          "INSERT INTO relations (from_member_id, to_member_id, relation_type) VALUES ($1, $2, $3)",
          [newMember.id, rel.toMemberId, rel.relationType],
        );
      }
    }

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

    const { paternalParentId, maternalParentId, ...otherChanges } = changes;

    const entries = Object.entries(otherChanges);
    if (entries.length > 0) {
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
    }

    const currentMember = get().members.find((m) => m.id === id);

    if (paternalParentId !== undefined) {
      const oldParent = currentMember?.parents.paternalParent;
      const newParent = paternalParentId;

      if (oldParent && oldParent !== newParent) {
        await db.execute(
          "DELETE FROM relations WHERE from_member_id = $1 AND to_member_id = $2 AND relation_type = 'parent'",
          [id, oldParent],
        );
      }
      if (newParent && newParent !== oldParent) {
        await db.execute(
          "INSERT INTO relations (from_member_id, to_member_id, relation_type) VALUES ($1, $2, $3)",
          [id, newParent, "parent"],
        );
      }
    }

    if (maternalParentId !== undefined) {
      const oldParent = currentMember?.parents.maternalParent;
      const newParent = maternalParentId;

      if (oldParent && oldParent !== newParent) {
        await db.execute(
          "DELETE FROM relations WHERE from_member_id = $1 AND to_member_id = $2 AND relation_type = 'parent'",
          [id, oldParent],
        );
      }
      if (newParent && newParent !== oldParent) {
        await db.execute(
          "INSERT INTO relations (from_member_id, to_member_id, relation_type) VALUES ($1, $2, $3)",
          [id, newParent, "parent"],
        );
      }
    }

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

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const db = get().db;
    if (!db) return;
    await db.execute(
      "INSERT INTO relations (from_member_id, to_member_id, relation_type) VALUES ($1, $2, $3)",
      [fromId, toId, type],
    );
    await get().refreshMembers();
  },

  removeRelation: async (fromId: string, toId: string, type: RelationType) => {
    const db = get().db;
    if (!db) return;
    await db.execute(
      "DELETE FROM relations WHERE from_member_id = $1 AND to_member_id = $2 AND relation_type = $3",
      [fromId, toId, type],
    );
    await get().refreshMembers();
  },

  addRelationType: async (id: string, description: string) => {
    const db = get().db;
    if (!db) return;
    await db.execute(
      "INSERT INTO relation_types (id, description) VALUES ($1, $2)",
      [id, description],
    );
    await get().refreshRelationTypes();
  },
}));
