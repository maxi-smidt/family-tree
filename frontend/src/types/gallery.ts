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

export interface GalleryImage {
  id: string;
  imageData: string;
  title: string | null;
  description: string | null;
  linkedMemberIds: string[];
  memberLinks: GalleryMemberLink[];
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
