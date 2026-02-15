import Database from "@tauri-apps/plugin-sql";
import {
  Member,
  MemberDB,
  MemberUpdate,
  RelationDB,
  RelationType,
  mapMemberToDB,
} from "@/types/member";
import { GalleryImage, GalleryImageDB } from "@/types/gallery";
import { EventDB, EventInput } from "@/types/event";
import { StoryDB, StoryInput } from "@/types/story";
import { DiseaseDB } from "@/types/disease";
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
    return await db.select<{ id: RelationType }[]>(
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

  // Event methods
  static async getEvents(db: Database) {
    return await db.select<EventDB[]>(QUERIES.EVENTS.SELECT_ALL);
  }

  static async getEventMemberLinks(db: Database) {
    return await db.select<{ event_id: string; member_id: string }[]>(
      QUERIES.EVENTS.SELECT_LINKS,
    );
  }

  static async getEventsByMember(db: Database, memberId: string) {
    return await db.select<EventDB[]>(QUERIES.EVENTS.SELECT_BY_MEMBER, [
      memberId,
    ]);
  }

  static async addEvent(
    db: Database,
    id: string,
    event: EventInput,
    createdAt: string,
  ) {
    await db.execute(QUERIES.EVENTS.INSERT, [
      id,
      event.eventType,
      event.date,
      event.location || null,
      event.description || null,
      createdAt,
    ]);
  }

  static async linkEventToMember(
    db: Database,
    eventId: string,
    memberId: string,
  ) {
    await db.execute(QUERIES.EVENTS.INSERT_LINK, [eventId, memberId]);
  }

  static async updateEvent(db: Database, id: string, event: EventInput) {
    await db.execute(QUERIES.EVENTS.UPDATE, [
      event.eventType,
      event.date,
      event.location || null,
      event.description || null,
      id,
    ]);
  }

  static async removeEvent(db: Database, id: string) {
    await db.execute(QUERIES.EVENTS.DELETE, [id]);
  }

  static async removeEventLinks(db: Database, eventId: string) {
    await db.execute(QUERIES.EVENTS.DELETE_LINKS, [eventId]);
  }

  // Story methods
  static async getStories(db: Database) {
    return await db.select<StoryDB[]>(QUERIES.STORIES.SELECT_ALL);
  }

  static async getStoryMemberLinks(db: Database) {
    return await db.select<{ story_id: string; member_id: string }[]>(
      QUERIES.STORIES.SELECT_LINKS,
    );
  }

  static async getStoriesByMember(db: Database, memberId: string) {
    return await db.select<StoryDB[]>(QUERIES.STORIES.SELECT_BY_MEMBER, [
      memberId,
    ]);
  }

  static async addStory(
    db: Database,
    id: string,
    story: StoryInput,
    now: string,
  ) {
    await db.execute(QUERIES.STORIES.INSERT, [
      id,
      story.title,
      story.content,
      now,
      now,
    ]);
  }

  static async linkStoryToMember(
    db: Database,
    storyId: string,
    memberId: string,
  ) {
    await db.execute(QUERIES.STORIES.INSERT_LINK, [storyId, memberId]);
  }

  static async updateStory(
    db: Database,
    id: string,
    story: StoryInput,
    updatedAt: string,
  ) {
    await db.execute(QUERIES.STORIES.UPDATE, [
      story.title,
      story.content,
      updatedAt,
      id,
    ]);
  }

  static async removeStory(db: Database, id: string) {
    await db.execute(QUERIES.STORIES.DELETE, [id]);
  }

  static async removeStoryLinks(db: Database, storyId: string) {
    await db.execute(QUERIES.STORIES.DELETE_LINKS, [storyId]);
  }

  // Disease methods
  static async getDiseases(db: Database) {
    return await db.select<DiseaseDB[]>(QUERIES.DISEASES.SELECT_ALL);
  }

  static async getDiseasesByMember(db: Database, memberId: string) {
    return await db.select<DiseaseDB[]>(QUERIES.DISEASES.SELECT_BY_MEMBER, [
      memberId,
    ]);
  }

  static async addDisease(
    db: Database,
    id: string,
    memberId: string,
    name: string,
    carrierStatus: string,
    diagnosisDate: string | null,
    notes: string | null,
  ) {
    await db.execute(QUERIES.DISEASES.INSERT, [
      id,
      memberId,
      name,
      carrierStatus,
      diagnosisDate,
      notes,
    ]);
  }

  static async updateDisease(
    db: Database,
    id: string,
    name: string,
    carrierStatus: string,
    diagnosisDate: string | null,
    notes: string | null,
  ) {
    await db.execute(QUERIES.DISEASES.UPDATE, [
      name,
      carrierStatus,
      diagnosisDate,
      notes,
      id,
    ]);
  }

  static async removeDisease(db: Database, id: string) {
    await db.execute(QUERIES.DISEASES.DELETE, [id]);
  }
}
