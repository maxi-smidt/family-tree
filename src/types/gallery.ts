export interface GalleryImage {
  id: string;
  imageData: string;
  title: string | null;
  description: string | null;
  linkedMemberIds: string[];
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
