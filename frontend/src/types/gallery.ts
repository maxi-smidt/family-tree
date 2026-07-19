/** A member association on a gallery image. Null coordinates mean the whole
 * image is linked; a complete coordinate set identifies a face region. */
export interface GalleryMemberLink {
  memberId: string;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

/** Raw gallery-link row returned by the API. */
export interface GalleryMemberLinkDB {
  gallery_image_id: string;
  member_id: string;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

/** A face region tagged as an unidentified person (no member) — created
 * via the gallery unknown-faces endpoints, which also creates and keeps in
 * sync exactly one open, tree-level research task (issue #736). */
export interface UnknownFace {
  id: string;
  galleryImageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  taskId: string | null;
  createdAt: string | null;
}

/** Raw unknown-face row returned by the API. */
export interface UnknownFaceDB {
  id: string;
  gallery_image_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  task_id: string | null;
  created_at: string | null;
}

export interface GalleryImage {
  id: string;
  imageData: string;
  title: string | null;
  description: string | null;
  linkedMemberIds: string[];
  memberLinks: GalleryMemberLink[];
  unknownFaces: UnknownFace[];
  createdAt: string;
  uploadedAt: string;
}

export interface GalleryImageDB {
  id: string;
  imageData: string;
  title: string | null;
  description: string | null;
  createdAt: string;
  uploadedAt: string;
}
