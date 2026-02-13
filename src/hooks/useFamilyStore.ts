import { create } from "zustand";
import {
  mapMemberFromDB,
  Member,
  MemberUpdate,
  RelationType,
} from "@/types/member";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { DATABASE_DIRECTORY, EXTENSION } from "@/constants";
import { Database as DatabaseType } from "@/types/database";
import Database from "@tauri-apps/plugin-sql";
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs";
import { getLayoutedElements } from "@/utils/layoutUtils";
import { GalleryImage } from "@/types/gallery";
import { DatabaseService } from "@/services/DatabaseService";
import { invoke } from "@tauri-apps/api/core";

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
  relationTypes: { id: RelationType }[];
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
  deleteGalleryImage: (id: string) => Promise<void>;
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
      get().refreshMembers(),
      get().refreshMetadata(dbInstance),
      get().refreshGalleryImages(),
      get().refreshRelationTypes(),
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

  refreshMembers: async () => {
    const db = get().db;
    if (!db) return;

    const result = await DatabaseService.getMembers(db);
    const relations = await DatabaseService.getRelations(db);

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
          if (parentGender === "m") {
            mapped.parents.paternalParent = r.to_member_id;
          } else if (parentGender === "f") {
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

    const imagesResult = await DatabaseService.getGalleryImages(db);
    const linksResult = await DatabaseService.getGalleryMemberLinks(db);

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

    await DatabaseService.addMember(db, newMember);

    if (newMember.parents.paternalParent) {
      await DatabaseService.addRelation(
        db,
        newMember.id,
        newMember.parents.paternalParent,
        "parent",
      );
    }
    if (newMember.parents.maternalParent) {
      await DatabaseService.addRelation(
        db,
        newMember.id,
        newMember.parents.maternalParent,
        "parent",
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
        await DatabaseService.addRelation(
          db,
          newMember.id,
          rel.toMemberId,
          rel.relationType,
        );
      }
    }

    await get().refreshMembers();
  },

  removeMember: async (memberId: string) => {
    const db = get().db;
    if (!db) return;
    await DatabaseService.removeMember(db, memberId);
    await get().refreshMembers();
  },

  updateMemberPartial: async (id: string, changes: MemberUpdate) => {
    const db = get().db;
    if (!db) return;

    const { paternalParentId, maternalParentId, ...otherChanges } = changes;

    await DatabaseService.updateMember(db, id, otherChanges);

    const currentMember = get().members.find((m) => m.id === id);

    if (paternalParentId !== undefined) {
      const oldParent = currentMember?.parents.paternalParent;
      const newParent = paternalParentId;

      if (oldParent && oldParent !== newParent) {
        await DatabaseService.removeRelation(
          db,
          id,
          oldParent,
          "parent" as RelationType,
        );
      }
      if (newParent && newParent !== oldParent) {
        await DatabaseService.addRelation(
          db,
          id,
          newParent,
          "parent" as RelationType,
        );
      }
    }

    if (maternalParentId !== undefined) {
      const oldParent = currentMember?.parents.maternalParent;
      const newParent = maternalParentId;

      if (oldParent && oldParent !== newParent) {
        await DatabaseService.removeRelation(
          db,
          id,
          oldParent,
          "parent" as RelationType,
        );
      }
      if (newParent && newParent !== oldParent) {
        await DatabaseService.addRelation(
          db,
          id,
          newParent,
          "parent" as RelationType,
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
      return DatabaseService.updateMemberPosition(db, id, pos.x, pos.y);
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
    await DatabaseService.addGalleryImage(db, id, image, now);

    if (image.linkedMemberIds && image.linkedMemberIds.length > 0) {
      for (const memberId of image.linkedMemberIds) {
        await DatabaseService.linkGalleryImageToMember(db, id, memberId);
      }
    }

    await get().refreshGalleryImages();
  },

  updateGalleryImage: async (id: string, changes: Partial<GalleryImage>) => {
    const db = get().db;
    if (!db) return;

    const { linkedMemberIds } = changes;

    await DatabaseService.updateGalleryImage(db, id, changes);

    if (linkedMemberIds) {
      await DatabaseService.removeGalleryImageLinks(db, id);
      for (const memberId of linkedMemberIds) {
        await DatabaseService.linkGalleryImageToMember(db, id, memberId);
      }
    }

    await get().refreshGalleryImages();
  },

  deleteGalleryImage: async (id: string) => {
    const db = get().db;
    if (!db) return;
    await DatabaseService.removeGalleryImage(db, id);
    await get().refreshGalleryImages();
  },

  addRelation: async (fromId: string, toId: string, type: RelationType) => {
    const db = get().db;
    if (!db) return;
    await DatabaseService.addRelation(db, fromId, toId, type);
    await get().refreshMembers();
  },

  removeRelation: async (fromId: string, toId: string, type: RelationType) => {
    const db = get().db;
    if (!db) return;
    await DatabaseService.removeRelation(db, fromId, toId, type);
    await get().refreshMembers();
  },

  addRelationType: async (id: string, description: string) => {
    const db = get().db;
    if (!db) return;
    await DatabaseService.addRelationType(db, id, description);
    await get().refreshRelationTypes();
  },
}));
