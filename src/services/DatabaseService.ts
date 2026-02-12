import Database from "@tauri-apps/plugin-sql";
import {
  Member,
  MemberDB,
  MemberUpdate,
  RelationDB,
  RelationType,
  RelationTypeDefinition,
  mapMemberToDB,
} from "@/types/member";
import { GalleryImage, GalleryImageDB } from "@/types/gallery";
import { QUERIES } from "@/db/queries";

export class DatabaseService {
  static async getMetadata(db: Database) {
    const rows = await db.select<{ key: string; value: string }[]>(
      QUERIES.METADATA.SELECT_ALL,
    );
    const metaObj: any = {};
    rows.forEach((row) => {
      metaObj[row.key] = row.value;
    });
    return metaObj;
  }

  static async getRelationTypes(db: Database) {
    return await db.select<RelationTypeDefinition[]>(
      QUERIES.RELATION_TYPES.SELECT_ALL,
    );
  }

  static async getMembers(db: Database) {
    return await db.select<MemberDB[]>(QUERIES.MEMBERS.SELECT_ALL);
  }

  static async getRelations(db: Database) {
    return await db.select<RelationDB[]>(QUERIES.RELATIONS.SELECT_ALL);
  }

  static async getGalleryImages(db: Database) {
    return await db.select<GalleryImageDB[]>(QUERIES.GALLERY.SELECT_IMAGES);
  }

  static async getGalleryMemberLinks(db: Database) {
    return await db.select<{ gallery_image_id: string; member_id: string }[]>(
      QUERIES.GALLERY.SELECT_LINKS,
    );
  }

  static async addMember(db: Database, member: Member) {
    const row = mapMemberToDB(member);
    await db.execute(QUERIES.MEMBERS.INSERT, [
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
    ]);
  }

  static async addRelation(
    db: Database,
    fromId: string,
    toId: string,
    type: RelationType,
  ) {
    await db.execute(QUERIES.RELATIONS.INSERT, [fromId, toId, type]);
  }

  static async removeMember(db: Database, memberId: string) {
    await db.execute(QUERIES.MEMBERS.DELETE, [memberId]);
  }

  static async updateMember(
    db: Database,
    id: string,
    changes: Omit<MemberUpdate, "paternalParentId" | "maternalParentId">,
  ) {
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
  }

  static async removeRelation(
    db: Database,
    fromId: string,
    toId: string,
    type: RelationType,
  ) {
    await db.execute(QUERIES.RELATIONS.DELETE, [fromId, toId, type]);
  }

  static async updateMemberPosition(
    db: Database,
    id: string,
    x: number,
    y: number,
  ) {
    await db.execute(QUERIES.MEMBERS.UPDATE_POSITION, [x, y, id]);
  }

  static async addGalleryImage(
    db: Database,
    id: string,
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
    now: string,
  ) {
    await db.execute(QUERIES.GALLERY.INSERT_IMAGE, [
      id,
      image.imageData,
      image.title,
      image.description,
      now,
      now,
    ]);
  }

  static async linkGalleryImageToMember(
    db: Database,
    imageId: string,
    memberId: string,
  ) {
    await db.execute(QUERIES.GALLERY.INSERT_LINK, [imageId, memberId]);
  }

  static async updateGalleryImage(
    db: Database,
    id: string,
    changes: Partial<GalleryImage>,
  ) {
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
  }

  static async removeGalleryImageLinks(db: Database, imageId: string) {
    await db.execute(QUERIES.GALLERY.DELETE_LINKS, [imageId]);
  }

  static async removeGalleryImage(db: Database, id: string) {
    await db.execute(QUERIES.GALLERY.DELETE_IMAGE, [id]);
  }

  static async addRelationType(db: Database, id: string, description: string) {
    await db.execute(QUERIES.RELATION_TYPES.INSERT, [id, description]);
  }

  static async initMetadata(
    db: Database,
    id: string,
    name: string,
    createdAt: string,
  ) {
    await db.execute(QUERIES.METADATA.INSERT, ["id", id]);
    await db.execute(QUERIES.METADATA.INSERT, ["createdAt", createdAt]);
    await db.execute(QUERIES.METADATA.INSERT, ["name", name]);
  }

  static async updateLastOpened(db: Database, now: string) {
    await db.execute(QUERIES.METADATA.UPDATE_LAST_OPENED, ["lastOpened", now]);
  }

  static async checkMetadataKey(db: Database, key: string) {
    return await db.select<{ value: string }[]>(
      QUERIES.METADATA.SELECT_BY_KEY,
      [key],
    );
  }
}
