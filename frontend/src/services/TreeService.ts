/**
 * Data-access layer for the FastAPI backend.
 *
 * Method names and return shapes intentionally match the previous SQLite-backed
 * service so the Zustand stores barely changed: each method now takes a
 * `treeId` instead of a database handle and issues an HTTP request whose JSON
 * payload mirrors the original row shapes (`MemberDB`, `RelationDB`, ...).
 */

import { api } from "@/services/api";
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
import { StoryAttachmentDB, StoryDB, StoryInput } from "@/types/story";
import { DiseaseDB, DiseaseInput, mapDiseaseInputToDB } from "@/types/disease";
import { ActivityDB } from "@/types/activity";
import { QualityReport } from "@/types/quality";
import { StatisticsReport } from "@/types/statistics";

const base = (treeId: string) => `/trees/${treeId}`;

export class TreeService {
  // --- Relation types ------------------------------------------------------
  static getRelationTypes(treeId: string) {
    return api.get<{ id: RelationType }[]>(`${base(treeId)}/relation-types`);
  }

  static addRelationType(treeId: string, id: string, description: string) {
    return api.post(`${base(treeId)}/relation-types`, { id, description });
  }

  // --- Members -------------------------------------------------------------
  static getMembers(treeId: string) {
    return api.get<MemberDB[]>(`${base(treeId)}/members`);
  }

  static getRelations(treeId: string) {
    return api.get<RelationDB[]>(`${base(treeId)}/relations`);
  }

  static addMember(treeId: string, member: Member) {
    return api.post(`${base(treeId)}/members`, mapMemberToDB(member));
  }

  static removeMember(treeId: string, memberId: string) {
    return api.del(`${base(treeId)}/members/${memberId}`);
  }

  static updateMember(
    treeId: string,
    id: string,
    changes: Omit<MemberUpdate, "paternalParentId" | "maternalParentId">,
  ) {
    if (Object.keys(changes).length === 0) return Promise.resolve();
    return api.patch(`${base(treeId)}/members/${id}`, changes);
  }

  static updateMemberPosition(
    treeId: string,
    id: string,
    x: number,
    y: number,
  ) {
    return api.patch(`${base(treeId)}/members/${id}`, {
      positionX: x,
      positionY: y,
    });
  }

  /** Persist many member positions in a single request (re-layout / drag). */
  static updateMemberPositions(
    treeId: string,
    positions: { id: string; positionX: number; positionY: number }[],
  ) {
    if (positions.length === 0) return Promise.resolve();
    return api.patch(`${base(treeId)}/members/positions`, positions);
  }

  /** Persist collapse/expand state for many members in a single request. */
  static updateMemberCollapsedBulk(
    treeId: string,
    updates: { id: string; isCollapsed: boolean }[],
  ) {
    if (updates.length === 0) return Promise.resolve();
    return api.patch(`${base(treeId)}/members/collapsed`, updates);
  }

  static addRelation(
    treeId: string,
    fromId: string,
    toId: string,
    type: RelationType,
  ) {
    return api.post(`${base(treeId)}/relations`, {
      from_member_id: fromId,
      to_member_id: toId,
      relation_type: type,
    });
  }

  static removeRelation(
    treeId: string,
    fromId: string,
    toId: string,
    type: RelationType,
  ) {
    return api.del(`${base(treeId)}/relations`, {
      from_member_id: fromId,
      to_member_id: toId,
      relation_type: type,
    });
  }

  // --- Gallery -------------------------------------------------------------
  static getGalleryImages(treeId: string) {
    return api.get<GalleryImageDB[]>(`${base(treeId)}/gallery/images`);
  }

  static getGalleryMemberLinks(treeId: string) {
    return api.get<{ gallery_image_id: string; member_id: string }[]>(
      `${base(treeId)}/gallery/links`,
    );
  }

  static addGalleryImage(
    treeId: string,
    id: string,
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
    now: string,
  ) {
    return api.post(`${base(treeId)}/gallery/images`, {
      id,
      imageData: image.imageData,
      title: image.title,
      description: image.description,
      createdAt: now,
      uploadedAt: now,
      member_ids: image.linkedMemberIds ?? [],
    });
  }

  static setGalleryImageLinks(
    treeId: string,
    imageId: string,
    memberIds: string[],
  ) {
    return api.put(`${base(treeId)}/gallery/images/${imageId}/links`, {
      member_ids: memberIds,
    });
  }

  static updateGalleryImage(
    treeId: string,
    id: string,
    changes: Partial<GalleryImage>,
  ) {
    const body: Record<string, unknown> = {};
    if (changes.imageData !== undefined) body.imageData = changes.imageData;
    if (changes.title !== undefined) body.title = changes.title;
    if (changes.description !== undefined)
      body.description = changes.description;
    if (Object.keys(body).length === 0) return Promise.resolve();
    return api.patch(`${base(treeId)}/gallery/images/${id}`, body);
  }

  static removeGalleryImage(treeId: string, id: string) {
    return api.del(`${base(treeId)}/gallery/images/${id}`);
  }

  // --- Events --------------------------------------------------------------
  static getEvents(treeId: string) {
    return api.get<EventDB[]>(`${base(treeId)}/events`);
  }

  static getEventMemberLinks(treeId: string) {
    return api.get<{ event_id: string; member_id: string }[]>(
      `${base(treeId)}/events/links`,
    );
  }

  static addEvent(
    treeId: string,
    id: string,
    event: EventInput,
    now: string,
    memberIds: string[] = [],
  ) {
    return api.post(`${base(treeId)}/events`, {
      id,
      event_type: event.eventType,
      date: event.date,
      location: event.location || null,
      description: event.description || null,
      created_at: now,
      member_ids: memberIds,
    });
  }

  static setEventLinks(treeId: string, eventId: string, memberIds: string[]) {
    return api.put(`${base(treeId)}/events/${eventId}/links`, {
      member_ids: memberIds,
    });
  }

  static updateEvent(treeId: string, id: string, event: EventInput) {
    return api.patch(`${base(treeId)}/events/${id}`, {
      event_type: event.eventType,
      date: event.date,
      location: event.location || null,
      description: event.description || null,
    });
  }

  static removeEvent(treeId: string, id: string) {
    return api.del(`${base(treeId)}/events/${id}`);
  }

  // --- Stories -------------------------------------------------------------
  static getStories(treeId: string) {
    return api.get<StoryDB[]>(`${base(treeId)}/stories`);
  }

  static getStoryMemberLinks(treeId: string) {
    return api.get<{ story_id: string; member_id: string }[]>(
      `${base(treeId)}/stories/links`,
    );
  }

  static addStory(
    treeId: string,
    id: string,
    story: StoryInput,
    now: string,
    memberIds: string[] = [],
  ) {
    return api.post(`${base(treeId)}/stories`, {
      id,
      title: story.title,
      content: story.content,
      created_at: now,
      updated_at: now,
      member_ids: memberIds,
    });
  }

  static setStoryLinks(treeId: string, storyId: string, memberIds: string[]) {
    return api.put(`${base(treeId)}/stories/${storyId}/links`, {
      member_ids: memberIds,
    });
  }

  static updateStory(
    treeId: string,
    id: string,
    story: StoryInput,
    updatedAt: string,
  ) {
    return api.patch(`${base(treeId)}/stories/${id}`, {
      title: story.title,
      content: story.content,
      updated_at: updatedAt,
    });
  }

  static removeStory(treeId: string, id: string) {
    return api.del(`${base(treeId)}/stories/${id}`);
  }

  static addStoryAttachment(
    treeId: string,
    storyId: string,
    filename: string,
    data: string,
  ) {
    return api.post<StoryAttachmentDB>(
      `${base(treeId)}/stories/${storyId}/attachments`,
      { filename, data },
    );
  }

  static updateStoryAttachment(
    treeId: string,
    storyId: string,
    attachmentId: string,
    filename: string,
  ) {
    return api.patch(
      `${base(treeId)}/stories/${storyId}/attachments/${attachmentId}`,
      { filename },
    );
  }

  static removeStoryAttachment(
    treeId: string,
    storyId: string,
    attachmentId: string,
  ) {
    return api.del(
      `${base(treeId)}/stories/${storyId}/attachments/${attachmentId}`,
    );
  }

  // --- Diseases ------------------------------------------------------------
  static getDiseases(treeId: string) {
    return api.get<DiseaseDB[]>(`${base(treeId)}/diseases`);
  }

  static addDisease(
    treeId: string,
    id: string,
    memberId: string,
    disease: DiseaseInput,
  ) {
    return api.post(`${base(treeId)}/diseases`, {
      id,
      member_id: memberId,
      ...mapDiseaseInputToDB(disease),
    });
  }

  static updateDisease(treeId: string, id: string, disease: DiseaseInput) {
    return api.patch(
      `${base(treeId)}/diseases/${id}`,
      mapDiseaseInputToDB(disease),
    );
  }

  static removeDisease(treeId: string, id: string) {
    return api.del(`${base(treeId)}/diseases/${id}`);
  }

  // --- Activity log ---------------------------------------------------------
  static getActivity(treeId: string) {
    return api.get<ActivityDB[]>(`${base(treeId)}/activity`);
  }

  // --- Quality report -------------------------------------------------------
  static getQualityReport(treeId: string) {
    return api.get<QualityReport>(`${base(treeId)}/quality-report`);
  }

  // --- Statistics -----------------------------------------------------------
  static getStatistics(treeId: string) {
    return api.get<StatisticsReport>(`${base(treeId)}/statistics`);
  }
}
