/**
 * Data-access layer for the FastAPI backend.
 *
 * Each method takes a `treeId` and issues an HTTP request whose JSON payload
 * mirrors the backend row shapes (`MemberDB`, `RelationDB`, ...).
 */

import { api } from "@/services/api";
import {
  SubtreeExtractPayload,
  SubtreeExtractPreview,
  Tree,
} from "@/types/tree";
import {
  Member,
  MemberDB,
  MemberUpdate,
  RelationDB,
  RelationType,
  RelationTypeDB,
  mapMemberToDB,
} from "@/types/member";
import {
  DuplicatePair,
  MergeFieldChoice,
  MergePreviewResult,
} from "@/types/merge";
import { GalleryImage, GalleryImageDB } from "@/types/gallery";
import { EventDB, EventInput } from "@/types/event";
import { StoryDB, StoryInput } from "@/types/story";
import { DiseaseDB, DiseaseInput, mapDiseaseInputToDB } from "@/types/disease";
import { DocumentDB, DocumentFileDB, DocumentInput } from "@/types/document";
import { GeocodeCandidate, GeocodeDB } from "@/types/geocode";
import { ActivityPageDB } from "@/types/activity";
import { QualityReport } from "@/types/quality";
import { CombinedStatisticsReport, StatisticsReport } from "@/types/statistics";
import { TreeStorageUsageDB } from "@/types/storage";
import { LinkGraphDB } from "@/types/linkGraph";

const base = (treeId: string) =>
  treeId.startsWith("vv_") ? `/virtual-views/${treeId}` : `/trees/${treeId}`;

export interface NeighborhoodDB {
  members: MemberDB[];
  relations: RelationDB[];
  root_id: string;
  truncated: boolean;
  total_member_count: number;
}

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

  static getNeighborhood(
    treeId: string,
    root?: string,
    up = 3,
    down = 3,
    partners = true,
  ) {
    const params = new URLSearchParams({
      up: String(up),
      down: String(down),
      partners: String(partners),
    });
    if (root) params.set("root", root);
    return api.get<NeighborhoodDB>(
      `${base(treeId)}/members/neighborhood?${params}`,
    );
  }

  static searchMembers(treeId: string, q: string, limit = 20) {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return api.get<MemberDB[]>(`${base(treeId)}/members/search?${params}`);
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

  /** Create a new tree seeded with a copy of the member (the bridge person)
   *  and link the two rows bidirectionally — all in one atomic request. */
  static createMemberSubtree(treeId: string, memberId: string, name: string) {
    return api.post<{ tree: Tree; anchor: MemberDB }>(
      `${base(treeId)}/members/${memberId}/subtree`,
      { name },
    );
  }

  /** Establish a tree-in-tree bridge on an already-existing target tree:
   *  either by finding a matching person already in it ("existing") or by
   *  copying this member into it as a new bridge person ("create"). Unlike
   *  updateMember, this always resolves a real bridge person on both sides.
   *  `field_choices` (mode="existing" only) resolves conflicting fields
   *  between the source member and the chosen counterpart. */
  static linkMemberToTree(
    treeId: string,
    memberId: string,
    body: {
      linked_tree_id: string;
      mode: "existing" | "create";
      counterpart_member_id?: string | null;
      field_choices?: Partial<Record<string, MergeFieldChoice>>;
    },
  ) {
    return api.post<{ tree: Tree; anchor: MemberDB }>(
      `${base(treeId)}/members/${memberId}/link`,
      body,
    );
  }

  /** List same-named members of `targetTreeId` that could be the bridge
   *  counterpart for `memberId` — candidates for `linkMemberToTree` with
   *  mode="existing", shaped as merge `DuplicatePair`s so the client can
   *  reuse the merge conflict-resolution UI. */
  static getLinkCandidates(
    treeId: string,
    memberId: string,
    targetTreeId: string,
  ) {
    const params = new URLSearchParams({ target_tree_id: targetTreeId });
    return api.get<{ candidates: DuplicatePair[] }>(
      `${base(treeId)}/members/${memberId}/link-candidates?${params}`,
    );
  }

  /** Resolve bridge-person drift: "push" writes this member's values onto the
   *  linked counterpart, "pull" adopts the counterpart's values. */
  static resolveBridgeDrift(
    treeId: string,
    memberId: string,
    direction: "push" | "pull",
  ) {
    return api.post<MemberDB>(
      `${base(treeId)}/members/${memberId}/bridge-sync`,
      {
        direction,
      },
    );
  }

  static updateMember(
    treeId: string,
    id: string,
    changes: MemberUpdate,
  ): Promise<MemberDB | undefined> {
    if (Object.keys(changes).length === 0) return Promise.resolve(undefined);
    return api.patch<MemberDB>(`${base(treeId)}/members/${id}`, changes);
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

  static setEventDocuments(
    treeId: string,
    eventId: string,
    documentIds: string[],
  ) {
    return api.put(`${base(treeId)}/events/${eventId}/documents`, {
      document_ids: documentIds,
    });
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

  static geocodeOverride(
    treeId: string,
    body: { query: string; lat: number; lon: number; display_name?: string },
  ) {
    return api.post<GeocodeDB>(`${base(treeId)}/geocode/override`, body);
  }

  static geocodeSearch(treeId: string, q: string, limit = 5) {
    return api.get<GeocodeCandidate[]>(
      `${base(treeId)}/geocode/search?q=${encodeURIComponent(q)}&limit=${limit}`,
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
      date: story.date ?? null,
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
      date: story.date ?? null,
      updated_at: updatedAt,
    });
  }

  static removeStory(treeId: string, id: string) {
    return api.del(`${base(treeId)}/stories/${id}`);
  }

  static setStoryDocuments(
    treeId: string,
    storyId: string,
    documentIds: string[],
  ) {
    return api.put(`${base(treeId)}/stories/${storyId}/documents`, {
      document_ids: documentIds,
    });
  }

  // --- Documents -----------------------------------------------------------
  static getDocuments(treeId: string) {
    return api.get<DocumentDB[]>(`${base(treeId)}/documents`);
  }

  static addDocument(
    treeId: string,
    input: DocumentInput,
    memberIds: string[],
  ) {
    return api.post<DocumentDB>(`${base(treeId)}/documents`, {
      title: input.title,
      description: input.description || null,
      document_date: input.documentDate || null,
      member_ids: memberIds,
    });
  }

  static updateDocument(treeId: string, id: string, input: DocumentInput) {
    return api.patch<DocumentDB>(`${base(treeId)}/documents/${id}`, {
      title: input.title,
      description: input.description || null,
      document_date: input.documentDate || null,
    });
  }

  static removeDocument(treeId: string, id: string) {
    return api.del(`${base(treeId)}/documents/${id}`);
  }

  static setDocumentMembers(
    treeId: string,
    documentId: string,
    memberIds: string[],
  ) {
    return api.put(`${base(treeId)}/documents/${documentId}/members`, {
      member_ids: memberIds,
    });
  }

  static addDocumentFile(
    treeId: string,
    documentId: string,
    filename: string,
    data: string,
  ) {
    return api.post<DocumentFileDB>(
      `${base(treeId)}/documents/${documentId}/files`,
      { filename, data },
    );
  }

  static addDocumentLink(
    treeId: string,
    documentId: string,
    url: string,
    filename: string | null,
  ) {
    return api.post<DocumentFileDB>(
      `${base(treeId)}/documents/${documentId}/links`,
      { url, filename },
    );
  }

  static renameDocumentFile(
    treeId: string,
    documentId: string,
    fileId: string,
    filename: string,
  ) {
    return api.patch<DocumentFileDB>(
      `${base(treeId)}/documents/${documentId}/files/${fileId}`,
      { filename },
    );
  }

  static removeDocumentFile(
    treeId: string,
    documentId: string,
    fileId: string,
  ) {
    return api.del(`${base(treeId)}/documents/${documentId}/files/${fileId}`);
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
  static previewSubtree(payload: Omit<SubtreeExtractPayload, "name">) {
    return api.post<SubtreeExtractPreview>("/trees/extract-subtree/preview", {
      ...payload,
      name: "",
    });
  }

  static extractSubtree(payload: SubtreeExtractPayload) {
    return api.post<{ job_id: string }>("/trees/extract-subtree", payload);
  }

  // --- Merge preview -------------------------------------------------------
  static previewMerge(sourceA: string, sourceB?: string) {
    return api.post<MergePreviewResult>("/trees/merge/preview", {
      source_a: sourceA,
      source_b: sourceB ?? null,
    });
  }

  // --- Activity log ---------------------------------------------------------
  static getActivity(
    treeId: string,
    params: {
      offset?: number;
      limit?: number;
      actor?: string;
      action?: string;
      target_type?: string;
    } = {},
  ) {
    return api.get<ActivityPageDB>(`${base(treeId)}/activity`, params);
  }

  // --- Quality report -------------------------------------------------------
  static getQualityReport(treeId: string) {
    return api.get<QualityReport>(`${base(treeId)}/quality-report`, {
      include_dismissed: true,
    });
  }

  static dismissQualityIssue(treeId: string, issueId: string) {
    return api.post<void>(
      `${base(treeId)}/quality-report/issues/${issueId}/dismiss`,
    );
  }

  static restoreQualityIssue(treeId: string, issueId: string) {
    return api.del<void>(
      `${base(treeId)}/quality-report/issues/${issueId}/dismiss`,
    );
  }

  // --- Statistics -----------------------------------------------------------
  static getStatistics(treeId: string) {
    return api.get<StatisticsReport>(`${base(treeId)}/statistics`);
  }

  static getCombinedStatistics(treeId: string) {
    return api.get<CombinedStatisticsReport>(
      `${base(treeId)}/statistics/combined`,
    );
  }

  // --- Storage usage -------------------------------------------------------
  static getStorageUsage(treeId: string) {
    return api.get<TreeStorageUsageDB>(`${base(treeId)}/storage`);
  }

  // --- Linked-trees graph ----------------------------------------------------
  static getLinkGraph(treeId: string) {
    return api.get<LinkGraphDB>(`${base(treeId)}/link-graph`);
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
