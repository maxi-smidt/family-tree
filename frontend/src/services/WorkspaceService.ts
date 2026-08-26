/**
 * Data-access layer for the FastAPI backend.
 *
 * Each method takes a `workspaceId` and issues an HTTP request whose JSON payload
 * mirrors the backend row shapes (`MemberDB`, `RelationDB`, ...).
 */

import { api, UPLOAD_STAGE_TIMEOUT_MS } from "@/services/api";
import {
  SubtreeExtractPayload,
  SubtreeExtractPreview,
  Workspace,
} from "@/types/workspace";
import {
  Member,
  MemberDB,
  MemberSearchHitDB,
  MemberUpdate,
  RelationDB,
  RelationType,
  RelationTypeDB,
  mapMemberToDB,
} from "@/types/member";
import {
  DuplicatePair,
  MemberMergePreview,
  MemberMergeRequest,
  MergeFieldChoice,
  MergePreviewResult,
} from "@/types/merge";
import {
  GalleryImage,
  GalleryImageDB,
  GalleryMemberLink,
  GalleryMemberLinkDB,
  UnknownFaceDB,
} from "@/types/gallery";
import { EventDB, EventInput } from "@/types/event";
import { StoryDB, StoryInput } from "@/types/story";
import { ResearchTaskDB } from "@/types/task";
import { DiseaseDB, DiseaseInput, mapDiseaseInputToDB } from "@/types/disease";
import {
  DocumentDB,
  DocumentFileDB,
  DocumentInput,
  DocumentSavePayload,
  DocumentUploadDB,
} from "@/types/document";
import { GeocodeCandidate, GeocodeDB } from "@/types/geocode";
import { ActivityPageDB, ActivityUndoDB } from "@/types/activity";
import { QualityReport } from "@/types/quality";
import {
  CombinedStatisticsReport,
  CustomWidgetAggregateResponse,
  CustomWidgetAggregationConfig,
  StatisticsReport,
  StatisticsScope,
} from "@/types/statistics";
import { WorkspaceStorageUsageDB } from "@/types/storage";
import { LinkGraphDB } from "@/types/linkGraph";
import { PresenceRosterDB } from "@/types/presence";

const base = (workspaceId: string) =>
  workspaceId.startsWith("vv_") ? `/virtual-views/${workspaceId}` : `/workspaces/${workspaceId}`;

export interface NeighborhoodDB {
  members: MemberDB[];
  relations: RelationDB[];
  root_id: string;
  truncated: boolean;
  total_member_count: number;
}

export type VirtualViewInput = {
  name: string;
  source_workspace_ids: string[];
};

export class WorkspaceService {
  // --- Relation types ------------------------------------------------------
  /** The relation type registry is instance-wide, not per tree. */
  static getRelationTypes() {
    return api.get<RelationTypeDB[]>("/relation-types");
  }

  // --- Legacy id resolution (#1012) -----------------------------------------
  /** Where a stale pre-conversion id (a cached deep link or public bookmark)
   *  was folded into during the v1->v2 migration, if it was a conversion
   *  source at all. Unauthenticated-safe. */
  static async resolveLegacyWorkspaceId(
    workspaceId: string,
  ): Promise<string | null> {
    const { target_workspace_id } = await api.get<{
      target_workspace_id: string | null;
    }>(`/workspaces/${workspaceId}/resolve-legacy-id`);
    return target_workspace_id;
  }

  // --- Members -------------------------------------------------------------
  static getMembers(workspaceId: string, surface = false) {
    const url = surface
      ? `${base(workspaceId)}/members?surface=true`
      : `${base(workspaceId)}/members`;
    return api.get<MemberDB[]>(url);
  }

  static getMember(workspaceId: string, id: string) {
    return api.get<MemberDB>(`${base(workspaceId)}/members/${id}`);
  }

  static getNeighborhood(
    workspaceId: string,
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
      `${base(workspaceId)}/members/neighborhood?${params}`,
    );
  }

  static searchMembers(workspaceId: string, q: string, limit = 20) {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return api.get<MemberDB[]>(`${base(workspaceId)}/members/search?${params}`);
  }

  /** Search readable workspaces other than the active one. */
  static searchOtherTrees(
    q: string,
    excludeWorkspaceId?: string,
    perTreeLimit = 8,
    limit = 40,
  ) {
    const params = new URLSearchParams({
      q,
      per_tree_limit: String(perTreeLimit),
      limit: String(limit),
    });
    if (excludeWorkspaceId && !excludeWorkspaceId.startsWith("vv_")) {
      params.set("exclude_workspace_id", excludeWorkspaceId);
    }
    return api.get<MemberSearchHitDB[]>(`/search?${params}`);
  }

  static getRelations(workspaceId: string) {
    return api.get<RelationDB[]>(`${base(workspaceId)}/relations`);
  }

  static addMember(workspaceId: string, member: Member) {
    return api.post(`${base(workspaceId)}/members`, mapMemberToDB(member));
  }

  static removeMember(workspaceId: string, memberId: string) {
    return api.del(`${base(workspaceId)}/members/${memberId}`);
  }

  /** Create a new tree seeded with a copy of the member (the bridge person)
   *  and link the two rows bidirectionally — all in one atomic request. */
  static createMemberSubtree(workspaceId: string, memberId: string, name: string) {
    return api.post<{ workspace: Workspace; anchor: MemberDB }>(
      `${base(workspaceId)}/members/${memberId}/subtree`,
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
    workspaceId: string,
    memberId: string,
    body: {
      linked_workspace_id: string;
      mode: "existing" | "create";
      counterpart_member_id?: string | null;
      field_choices?: Partial<Record<string, MergeFieldChoice>>;
    },
  ) {
    return api.post<{ workspace: Workspace; anchor: MemberDB }>(
      `${base(workspaceId)}/members/${memberId}/link`,
      body,
    );
  }

  /** List same-named members of `targetWorkspaceId` that could be the bridge
   *  counterpart for `memberId` — candidates for `linkMemberToTree` with
   *  mode="existing", shaped as merge `DuplicatePair`s so the client can
   *  reuse the merge conflict-resolution UI. */
  static getLinkCandidates(
    workspaceId: string,
    memberId: string,
    targetWorkspaceId: string,
  ) {
    const params = new URLSearchParams({ target_workspace_id: targetWorkspaceId });
    return api.get<{ candidates: DuplicatePair[] }>(
      `${base(workspaceId)}/members/${memberId}/link-candidates?${params}`,
    );
  }

  /** Resolve bridge-person drift: "push" writes this member's values onto the
   *  linked counterpart, "pull" adopts the counterpart's values. */
  static resolveBridgeDrift(
    workspaceId: string,
    memberId: string,
    direction: "push" | "pull",
  ) {
    return api.post<MemberDB>(
      `${base(workspaceId)}/members/${memberId}/bridge-sync`,
      {
        direction,
      },
    );
  }

  static updateMember(
    workspaceId: string,
    id: string,
    changes: MemberUpdate,
  ): Promise<MemberDB | undefined> {
    if (Object.keys(changes).length === 0) return Promise.resolve(undefined);
    return api.patch<MemberDB>(`${base(workspaceId)}/members/${id}`, changes);
  }

  static updateMemberPosition(
    workspaceId: string,
    id: string,
    x: number,
    y: number,
  ) {
    return api.patch(`${base(workspaceId)}/members/${id}`, {
      positionX: x,
      positionY: y,
    });
  }

  /** Persist many member positions in a single request (re-layout / drag). */
  static updateMemberPositions(
    workspaceId: string,
    positions: { id: string; positionX: number; positionY: number }[],
  ) {
    if (positions.length === 0) return Promise.resolve();
    return api.patch(`${base(workspaceId)}/members/positions`, positions);
  }

  /** Persist collapse/expand state for many members in a single request. */
  static updateMemberCollapsedBulk(
    workspaceId: string,
    updates: { id: string; isCollapsed: boolean }[],
  ) {
    if (updates.length === 0) return Promise.resolve();
    return api.patch(`${base(workspaceId)}/members/collapsed`, updates);
  }

  static addRelation(
    workspaceId: string,
    fromId: string,
    toId: string,
    type: RelationType,
  ) {
    return api.post(`${base(workspaceId)}/relations`, {
      from_member_id: fromId,
      to_member_id: toId,
      relation_type: type,
    });
  }

  static removeRelation(
    workspaceId: string,
    fromId: string,
    toId: string,
    type: RelationType,
  ) {
    return api.del(`${base(workspaceId)}/relations`, {
      from_member_id: fromId,
      to_member_id: toId,
      relation_type: type,
    });
  }

  // --- Gallery -------------------------------------------------------------
  static getGalleryImages(workspaceId: string) {
    return api.get<GalleryImageDB[]>(`${base(workspaceId)}/gallery/images`);
  }

  static getGalleryMemberLinks(workspaceId: string) {
    return api.get<GalleryMemberLinkDB[]>(`${base(workspaceId)}/gallery/links`);
  }

  /** Stream a picked image file to the gallery as multipart form-data. The
   *  bytes never become a base64 data URL in JS state or the request body; the
   *  backend streams them to disk and applies all image safeguards. */
  static uploadGalleryImage(
    workspaceId: string,
    id: string,
    file: File,
    meta: {
      title: string | null;
      description: string | null;
      memberIds: string[];
    },
    now: string,
  ) {
    const formData = new FormData();
    formData.append("id", id);
    formData.append("image", file);
    if (meta.title !== null) formData.append("title", meta.title);
    if (meta.description !== null)
      formData.append("description", meta.description);
    // created_at (photo-taken date) is left for the backend to fill in from
    // the image's EXIF data, or leave null — only uploaded_at is "now".
    formData.append("uploaded_at", now);
    for (const memberId of meta.memberIds)
      formData.append("member_ids", memberId);
    return api.postForm<GalleryImageDB>(
      `${base(workspaceId)}/gallery/images`,
      formData,
    );
  }

  static setGalleryImageLinks(
    workspaceId: string,
    imageId: string,
    links: GalleryMemberLink[],
  ) {
    return api.put(`${base(workspaceId)}/gallery/images/${imageId}/links`, {
      links: links.map((link) => ({
        member_id: link.memberId,
        x: link.x,
        y: link.y,
        w: link.w,
        h: link.h,
      })),
    });
  }

  static updateGalleryImage(
    workspaceId: string,
    id: string,
    changes: Partial<GalleryImage>,
  ) {
    // Only metadata is editable — image bytes are immutable after upload, so
    // imageData is intentionally never sent back (it only carries the stored
    // media URL).
    const body: Record<string, unknown> = {};
    if (changes.title !== undefined) body.title = changes.title;
    if (changes.description !== undefined)
      body.description = changes.description;
    if (changes.createdAt !== undefined) body.createdAt = changes.createdAt;
    if (Object.keys(body).length === 0) return Promise.resolve();
    return api.patch(`${base(workspaceId)}/gallery/images/${id}`, body);
  }

  static removeGalleryImage(workspaceId: string, id: string) {
    return api.del(`${base(workspaceId)}/gallery/images/${id}`);
  }

  // --- Gallery: unknown-face tags (issue #736) ------------------------------
  static getGalleryUnknownFaces(workspaceId: string) {
    return api.get<UnknownFaceDB[]>(`${base(workspaceId)}/gallery/unknown-faces`);
  }

  /** Tag a face region as an unknown person; the backend creates exactly one
   *  open, tree-level research task and returns the linked face row. */
  static addGalleryUnknownFace(
    workspaceId: string,
    imageId: string,
    face: {
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      createdAt: string;
      taskTitle: string | null;
      taskNotes: string | null;
    },
  ) {
    return api.post<UnknownFaceDB>(
      `${base(workspaceId)}/gallery/images/${imageId}/unknown-faces`,
      {
        id: face.id,
        x: face.x,
        y: face.y,
        w: face.w,
        h: face.h,
        created_at: face.createdAt,
        task_title: face.taskTitle,
        task_notes: face.taskNotes,
      },
    );
  }

  static updateGalleryUnknownFace(
    workspaceId: string,
    faceId: string,
    region: { x: number; y: number; w: number; h: number },
  ) {
    return api.patch<UnknownFaceDB>(
      `${base(workspaceId)}/gallery/unknown-faces/${faceId}`,
      region,
    );
  }

  static resolveGalleryUnknownFace(
    workspaceId: string,
    faceId: string,
    memberId: string,
  ) {
    return api.post(`${base(workspaceId)}/gallery/unknown-faces/${faceId}/resolve`, {
      member_id: memberId,
    });
  }

  static removeGalleryUnknownFace(workspaceId: string, faceId: string) {
    return api.del(`${base(workspaceId)}/gallery/unknown-faces/${faceId}`);
  }

  // --- Events --------------------------------------------------------------
  static getEvents(workspaceId: string) {
    return api.get<EventDB[]>(`${base(workspaceId)}/events`);
  }

  static getEventMemberLinks(workspaceId: string) {
    return api.get<{ event_id: string; member_id: string }[]>(
      `${base(workspaceId)}/events/links`,
    );
  }

  static addEvent(
    workspaceId: string,
    id: string,
    event: EventInput,
    now: string,
    memberIds: string[] = [],
  ) {
    return api.post(`${base(workspaceId)}/events`, {
      id,
      event_type: event.eventType,
      date: event.date,
      location: event.location || null,
      description: event.description || null,
      created_at: now,
      member_ids: memberIds,
    });
  }

  static setEventLinks(workspaceId: string, eventId: string, memberIds: string[]) {
    return api.put(`${base(workspaceId)}/events/${eventId}/links`, {
      member_ids: memberIds,
    });
  }

  static updateEvent(workspaceId: string, id: string, event: EventInput) {
    return api.patch(`${base(workspaceId)}/events/${id}`, {
      event_type: event.eventType,
      date: event.date,
      location: event.location || null,
      description: event.description || null,
    });
  }

  static removeEvent(workspaceId: string, id: string) {
    return api.del(`${base(workspaceId)}/events/${id}`);
  }

  static setEventDocuments(
    workspaceId: string,
    eventId: string,
    documentIds: string[],
  ) {
    return api.put(`${base(workspaceId)}/events/${eventId}/documents`, {
      document_ids: documentIds,
    });
  }

  // --- Geocode -------------------------------------------------------------
  static geocodeLocations(workspaceId: string, locations: string[]) {
    return api.post<GeocodeDB[]>(`${base(workspaceId)}/geocode`, { locations });
  }

  static geocodePreview(workspaceId: string, q: string) {
    return api.get<GeocodeDB>(
      `${base(workspaceId)}/geocode/preview?q=${encodeURIComponent(q)}`,
    );
  }

  static geocodeOverride(
    workspaceId: string,
    body: { query: string; lat: number; lon: number; display_name?: string },
  ) {
    return api.post<GeocodeDB>(`${base(workspaceId)}/geocode/override`, body);
  }

  static geocodeSearch(workspaceId: string, q: string, limit = 5) {
    return api.get<GeocodeCandidate[]>(
      `${base(workspaceId)}/geocode/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }

  // --- Stories -------------------------------------------------------------
  static getStories(workspaceId: string) {
    return api.get<StoryDB[]>(`${base(workspaceId)}/stories`);
  }

  static getStoryMemberLinks(workspaceId: string) {
    return api.get<{ story_id: string; member_id: string }[]>(
      `${base(workspaceId)}/stories/links`,
    );
  }

  static addStory(
    workspaceId: string,
    id: string,
    story: StoryInput,
    now: string,
    memberIds: string[] = [],
  ) {
    return api.post(`${base(workspaceId)}/stories`, {
      id,
      title: story.title,
      content: story.content,
      date: story.date ?? null,
      created_at: now,
      updated_at: now,
      member_ids: memberIds,
    });
  }

  static setStoryLinks(workspaceId: string, storyId: string, memberIds: string[]) {
    return api.put(`${base(workspaceId)}/stories/${storyId}/links`, {
      member_ids: memberIds,
    });
  }

  static updateStory(
    workspaceId: string,
    id: string,
    story: StoryInput,
    updatedAt: string,
  ) {
    return api.patch(`${base(workspaceId)}/stories/${id}`, {
      title: story.title,
      content: story.content,
      date: story.date ?? null,
      updated_at: updatedAt,
    });
  }

  static removeStory(workspaceId: string, id: string) {
    return api.del(`${base(workspaceId)}/stories/${id}`);
  }

  static setStoryDocuments(
    workspaceId: string,
    storyId: string,
    documentIds: string[],
  ) {
    return api.put(`${base(workspaceId)}/stories/${storyId}/documents`, {
      document_ids: documentIds,
    });
  }

  // --- Research tasks ------------------------------------------------------
  static getTasks(workspaceId: string) {
    return api.get<ResearchTaskDB[]>(`${base(workspaceId)}/tasks`);
  }

  static addTask(
    workspaceId: string,
    id: string,
    title: string,
    notes: string | null,
    createdAt: string,
    memberIds: string[] = [],
  ) {
    return api.post<ResearchTaskDB>(`${base(workspaceId)}/tasks`, {
      id,
      title,
      notes,
      created_at: createdAt,
      member_ids: memberIds,
    });
  }

  static setTaskLinks(workspaceId: string, taskId: string, memberIds: string[]) {
    return api.put(`${base(workspaceId)}/tasks/${taskId}/links`, {
      member_ids: memberIds,
    });
  }

  static updateTask(
    workspaceId: string,
    id: string,
    title: string,
    notes: string | null,
    done: boolean,
    doneAt: string | null,
  ) {
    return api.patch<ResearchTaskDB>(`${base(workspaceId)}/tasks/${id}`, {
      title,
      notes,
      done,
      done_at: doneAt,
    });
  }

  static removeTask(workspaceId: string, id: string) {
    return api.del(`${base(workspaceId)}/tasks/${id}`);
  }

  // --- Documents -----------------------------------------------------------
  static getDocuments(workspaceId: string) {
    return api.get<DocumentDB[]>(`${base(workspaceId)}/documents`);
  }

  static addDocument(
    workspaceId: string,
    input: DocumentInput,
    memberIds: string[],
  ) {
    return api.post<DocumentDB>(`${base(workspaceId)}/documents`, {
      title: input.title,
      description: input.description || null,
      document_date: input.documentDate || null,
      member_ids: memberIds,
    });
  }

  static updateDocument(workspaceId: string, id: string, input: DocumentInput) {
    return api.patch<DocumentDB>(`${base(workspaceId)}/documents/${id}`, {
      title: input.title,
      description: input.description || null,
      document_date: input.documentDate || null,
    });
  }

  /** Stream a picked file into the staging area. Returns the staged upload,
   *  whose id is later attached by `saveDocument`. */
  static stageDocumentUpload(workspaceId: string, file: File, filename: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("filename", filename);
    return api.postForm<DocumentUploadDB>(
      `${base(workspaceId)}/documents/uploads`,
      formData,
      UPLOAD_STAGE_TIMEOUT_MS,
    );
  }

  /** Create-or-update a document and apply every file change in one atomic
   *  request. `documentId` is client-generated so a create that gets retried
   *  upserts instead of duplicating. */
  static saveDocument(
    workspaceId: string,
    documentId: string,
    payload: DocumentSavePayload,
  ) {
    return api.put<DocumentDB>(
      `${base(workspaceId)}/documents/${documentId}`,
      payload,
    );
  }

  static removeDocument(workspaceId: string, id: string) {
    return api.del(`${base(workspaceId)}/documents/${id}`);
  }

  static setDocumentMembers(
    workspaceId: string,
    documentId: string,
    memberIds: string[],
  ) {
    return api.put(`${base(workspaceId)}/documents/${documentId}/members`, {
      member_ids: memberIds,
    });
  }

  static addDocumentFile(
    workspaceId: string,
    documentId: string,
    file: File,
    filename: string,
  ) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("filename", filename);
    return api.postForm<DocumentFileDB>(
      `${base(workspaceId)}/documents/${documentId}/files`,
      formData,
    );
  }

  static addDocumentLink(
    workspaceId: string,
    documentId: string,
    url: string,
    filename: string | null,
  ) {
    return api.post<DocumentFileDB>(
      `${base(workspaceId)}/documents/${documentId}/links`,
      { url, filename },
    );
  }

  static renameDocumentFile(
    workspaceId: string,
    documentId: string,
    fileId: string,
    filename: string,
  ) {
    return api.patch<DocumentFileDB>(
      `${base(workspaceId)}/documents/${documentId}/files/${fileId}`,
      { filename },
    );
  }

  static removeDocumentFile(
    workspaceId: string,
    documentId: string,
    fileId: string,
  ) {
    return api.del(`${base(workspaceId)}/documents/${documentId}/files/${fileId}`);
  }

  // --- Diseases ------------------------------------------------------------
  static getDiseases(workspaceId: string) {
    return api.get<DiseaseDB[]>(`${base(workspaceId)}/diseases`);
  }

  static addDisease(
    workspaceId: string,
    id: string,
    memberId: string,
    disease: DiseaseInput,
  ) {
    return api.post(`${base(workspaceId)}/diseases`, {
      id,
      member_id: memberId,
      ...mapDiseaseInputToDB(disease),
    });
  }

  static updateDisease(workspaceId: string, id: string, disease: DiseaseInput) {
    return api.patch(
      `${base(workspaceId)}/diseases/${id}`,
      mapDiseaseInputToDB(disease),
    );
  }

  static removeDisease(workspaceId: string, id: string) {
    return api.del(`${base(workspaceId)}/diseases/${id}`);
  }

  // --- Sub-tree extraction -------------------------------------------------
  static previewSubtree(payload: Omit<SubtreeExtractPayload, "name">) {
    return api.post<SubtreeExtractPreview>("/workspaces/extract-subtree/preview", {
      ...payload,
      name: "",
    });
  }

  static extractSubtree(payload: SubtreeExtractPayload) {
    return api.post<{ job_id: string }>("/workspaces/extract-subtree", payload);
  }

  // --- Merge preview -------------------------------------------------------
  static previewMerge(sourceA: string, sourceB?: string) {
    return api.post<MergePreviewResult>("/workspaces/merge/preview", {
      source_a: sourceA,
      source_b: sourceB ?? null,
    });
  }

  // --- Activity log ---------------------------------------------------------
  static getActivity(
    workspaceId: string,
    params: {
      offset?: number;
      limit?: number;
      actor?: string;
      action?: string;
      target_type?: string;
    } = {},
  ) {
    return api.get<ActivityPageDB>(`${base(workspaceId)}/activity`, params);
  }

  static undoActivity(workspaceId: string, entryId: string) {
    return api.post<ActivityUndoDB>(
      `${base(workspaceId)}/activity/${entryId}/undo`,
    );
  }

  // --- Quality report -------------------------------------------------------
  static getQualityReport(workspaceId: string) {
    return api.get<QualityReport>(`${base(workspaceId)}/quality-report`, {
      include_dismissed: true,
    });
  }

  static dismissQualityIssue(workspaceId: string, issueId: string) {
    return api.post<void>(
      `${base(workspaceId)}/quality-report/issues/${issueId}/dismiss`,
    );
  }

  static restoreQualityIssue(workspaceId: string, issueId: string) {
    return api.del<void>(
      `${base(workspaceId)}/quality-report/issues/${issueId}/dismiss`,
    );
  }

  /** Field conflicts + transfer counts for merging `removeId` into `keepId`
   *  in place (#729), reusing the merge conflict-resolution UI. */
  static getMemberMergePreview(
    workspaceId: string,
    keepId: string,
    removeId: string,
  ) {
    const params = new URLSearchParams({ other: removeId });
    return api.get<MemberMergePreview>(
      `${base(workspaceId)}/members/${keepId}/merge-preview?${params}`,
    );
  }

  /** Merge two members of the same tree in place: `keepId` survives,
   *  `removeId` is deleted after its relations/content are re-pointed. */
  static mergeMembers(workspaceId: string, body: MemberMergeRequest) {
    return api.post<MemberDB>(`${base(workspaceId)}/members/merge`, body);
  }

  // --- Statistics -----------------------------------------------------------
  static getStatistics(workspaceId: string) {
    return api.get<StatisticsReport>(`${base(workspaceId)}/statistics`);
  }

  static getCombinedStatistics(workspaceId: string) {
    return api.get<CombinedStatisticsReport>(
      `${base(workspaceId)}/statistics/combined`,
    );
  }

  static getCustomWidgetAggregations(
    workspaceId: string,
    scope: StatisticsScope,
    widgets: CustomWidgetAggregationConfig[],
  ) {
    return api.post<CustomWidgetAggregateResponse>(
      `${base(workspaceId)}/statistics/widgets/aggregate`,
      {
        scope,
        widgets: widgets.map(
          ({ id, chartType, dimensionId, measureId, breakdownId }) => ({
            id,
            chartType,
            dimensionId,
            measureId,
            breakdownId,
          }),
        ),
      },
    );
  }

  // --- Storage usage -------------------------------------------------------
  static getStorageUsage(workspaceId: string) {
    return api.get<WorkspaceStorageUsageDB>(`${base(workspaceId)}/storage`);
  }

  // --- Linked-workspaces graph ----------------------------------------------------
  static getLinkGraph(workspaceId: string) {
    return api.get<LinkGraphDB>(`${base(workspaceId)}/link-graph`);
  }

  // --- Virtual views --------------------------------------------------------
  static listVirtualViews() {
    return api.get<Workspace[]>("/virtual-views");
  }

  static createVirtualView(name: string, sourceWorkspaceIds: string[]) {
    return api.post<Workspace>("/virtual-views", {
      name,
      source_workspace_ids: sourceWorkspaceIds,
    });
  }

  static updateVirtualView(
    id: string,
    changes: { name?: string; source_workspace_ids?: string[] },
  ) {
    return api.patch<Workspace>(`/virtual-views/${id}`, changes);
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

  // --- Live presence --------------------------------------------------------
  // Presence exists only for real workspaces (never virtual views), so these use the
  // fixed `/workspaces` prefix rather than the vv-aware `base()` helper.
  static sendPresence(
    workspaceId: string,
    editingMemberId: string | null,
    signal?: AbortSignal,
  ) {
    return api.post<PresenceRosterDB>(
      `/workspaces/${workspaceId}/presence`,
      {
        editing_member_id: editingMemberId,
      },
      signal,
    );
  }

  static leavePresence(workspaceId: string) {
    return api.del<void>(`/workspaces/${workspaceId}/presence`);
  }
}
