/**
 * Data-access layer for the FastAPI backend.
 *
 * Each method takes a `treeId` and issues an HTTP request whose JSON payload
 * mirrors the backend row shapes (`MemberDB`, `RelationDB`, ...).
 */

import { api } from "@/services/api";
import { Tree } from "@/types/tree";
import {
  Member,
  MemberDB,
  MemberUpdate,
  RelationDB,
  RelationType,
  RelationTypeDB,
  mapMemberToDB,
} from "@/types/member";
import { MergePreviewResult } from "@/types/merge";
import { GalleryImage, GalleryImageDB } from "@/types/gallery";
import { EventDB, EventInput } from "@/types/event";
import { StoryAttachmentDB, StoryDB, StoryInput } from "@/types/story";
import { DiseaseDB, DiseaseInput, mapDiseaseInputToDB } from "@/types/disease";
import { CitationDB, EvidenceOps, SourceDB, SourceInput } from "@/types/source";
import { GeocodeDB } from "@/types/geocode";
import { ActivityDB } from "@/types/activity";
import { QualityReport } from "@/types/quality";
import { StatisticsReport } from "@/types/statistics";

const base = (treeId: string) =>
  treeId.startsWith("vv_") ? `/virtual-views/${treeId}` : `/trees/${treeId}`;

export type VirtualViewInput = {
  name: string;
  source_tree_ids: string[];
};

export class TreeService {
  // --- Relation types ------------------------------------------------------
  /** The relation type registry is instance-wide, not per tree. */
  static getRelationTypes() {
    return api.get<RelationTypeDB[]>("/relation-types");
  }

  // --- Members -------------------------------------------------------------
  static getMembers(treeId: string, surface = false) {
    const url = surface
      ? `${base(treeId)}/members?surface=true`
      : `${base(treeId)}/members`;
    return api.get<MemberDB[]>(url);
  }

  static getMember(treeId: string, id: string) {
    return api.get<MemberDB>(`${base(treeId)}/members/${id}`);
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

  // --- Geocode -------------------------------------------------------------
  static geocodeLocations(treeId: string, locations: string[]) {
    return api.post<GeocodeDB[]>(`${base(treeId)}/geocode`, { locations });
  }

  static geocodePreview(treeId: string, q: string) {
    return api.get<GeocodeDB>(
      `${base(treeId)}/geocode/preview?q=${encodeURIComponent(q)}`,
    );
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

  // --- Sources -------------------------------------------------------------
  static getSources(treeId: string) {
    return api.get<SourceDB[]>(`${base(treeId)}/sources`);
  }

  static getCitations(treeId: string) {
    return api.get<CitationDB[]>(`${base(treeId)}/sources/citations`);
  }

  static addSource(treeId: string, id: string, input: SourceInput, now: string) {
    return api.post<SourceDB>(`${base(treeId)}/sources`, {
      id,
      title: input.title,
      author: input.author || null,
      publication_info: input.publicationInfo || null,
      repository: input.repository || null,
      source_date: input.sourceDate || null,
      notes: input.notes || null,
      created_at: now,
      updated_at: now,
    });
  }

  static updateSource(treeId: string, id: string, input: SourceInput) {
    return api.patch<SourceDB>(`${base(treeId)}/sources/${id}`, {
      title: input.title,
      author: input.author || null,
      publication_info: input.publicationInfo || null,
      repository: input.repository || null,
      source_date: input.sourceDate || null,
      notes: input.notes || null,
    });
  }

  static removeSource(treeId: string, id: string) {
    return api.del(`${base(treeId)}/sources/${id}`);
  }

  static addSourceEvidenceFile(
    treeId: string,
    sourceId: string,
    filename: string,
    data: string,
  ) {
    return api.post(
      `${base(treeId)}/sources/${sourceId}/evidence`,
      { kind: "file", filename, data },
    );
  }

  static addSourceEvidenceLink(
    treeId: string,
    sourceId: string,
    url: string,
    label: string | null,
  ) {
    return api.post(
      `${base(treeId)}/sources/${sourceId}/evidence`,
      { kind: "link", url, filename: label },
    );
  }

  static renameSourceEvidence(
    treeId: string,
    sourceId: string,
    evidenceId: string,
    filename: string,
  ) {
    return api.patch(
      `${base(treeId)}/sources/${sourceId}/evidence/${evidenceId}`,
      { filename },
    );
  }

  static removeSourceEvidence(
    treeId: string,
    sourceId: string,
    evidenceId: string,
  ) {
    return api.del(
      `${base(treeId)}/sources/${sourceId}/evidence/${evidenceId}`,
    );
  }

  static addCitation(
    treeId: string,
    id: string,
    sourceId: string,
    memberId: string,
    factType: string,
    page: string | null,
    detail: string | null,
    now: string,
  ) {
    return api.post<CitationDB>(`${base(treeId)}/sources/citations`, {
      id,
      source_id: sourceId,
      member_id: memberId,
      fact_type: factType,
      page: page || null,
      detail: detail || null,
      created_at: now,
    });
  }

  static updateCitation(
    treeId: string,
    id: string,
    factType: string,
    page: string | null,
    detail: string | null,
  ) {
    return api.patch(`${base(treeId)}/sources/citations/${id}`, {
      fact_type: factType,
      page: page || null,
      detail: detail || null,
    });
  }

  static removeCitation(treeId: string, id: string) {
    return api.del(`${base(treeId)}/sources/citations/${id}`);
  }

  static applyEvidenceOps(
    treeId: string,
    sourceId: string,
    ops: EvidenceOps,
  ): Promise<unknown>[] {
    const tasks: Promise<unknown>[] = [];
    for (const id of ops.removedIds) {
      tasks.push(TreeService.removeSourceEvidence(treeId, sourceId, id));
    }
    for (const { id, filename } of ops.renamed) {
      tasks.push(TreeService.renameSourceEvidence(treeId, sourceId, id, filename));
    }
    for (const f of ops.addedFiles) {
      tasks.push(
        TreeService.addSourceEvidenceFile(treeId, sourceId, f.filename, f.dataUrl),
      );
    }
    for (const link of ops.addedLinks) {
      tasks.push(
        TreeService.addSourceEvidenceLink(treeId, sourceId, link.url, link.label),
      );
    }
    return tasks;
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

  // --- Sub-tree extraction -------------------------------------------------
  static previewSubtree(payload: {
    source_tree_id: string;
    root_member_id: string;
    direction: "descendants" | "ancestors" | "both";
    depth: number | null;
    include_partners: boolean;
  }) {
    return api.post<{ member_count: number; relation_count: number }>(
      "/trees/extract-subtree/preview",
      { ...payload, name: "" },
    );
  }

  static extractSubtree(payload: {
    name: string;
    source_tree_id: string;
    root_member_id: string;
    direction: "descendants" | "ancestors" | "both";
    depth: number | null;
    include_partners: boolean;
  }) {
    return api.post<Tree>("/trees/extract-subtree", payload);
  }

  // --- Merge preview -------------------------------------------------------
  static previewMerge(sourceA: string, sourceB?: string) {
    return api.post<MergePreviewResult>("/trees/merge/preview", {
      source_a: sourceA,
      source_b: sourceB ?? null,
    });
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

  // --- Virtual views --------------------------------------------------------
  static listVirtualViews() {
    return api.get<Tree[]>("/virtual-views");
  }

  static createVirtualView(name: string, sourceTreeIds: string[]) {
    return api.post<Tree>("/virtual-views", {
      name,
      source_tree_ids: sourceTreeIds,
    });
  }

  static updateVirtualView(
    id: string,
    changes: { name?: string; source_tree_ids?: string[] },
  ) {
    return api.patch<Tree>(`/virtual-views/${id}`, changes);
  }

  static deleteVirtualView(id: string) {
    return api.del(`/virtual-views/${id}`);
  }

  static recomputeVirtualViewMatches(id: string) {
    return api.post<{ groupCount: number; mergedMemberCount: number }>(
      `/virtual-views/${id}/recompute-matches`,
      {},
    );
  }
}
