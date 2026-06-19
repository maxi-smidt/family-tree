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
  image_data: string;
  title: string | null;
  description: string | null;
  created_at: string;
  uploaded_at: string;
}

export function mapGalleryImageFromDB(
  row: GalleryImageDB,
  linkedMemberIds: string[],
): GalleryImage {
  return {
    id: row.id,
    imageData: row.image_data,
    title: row.title,
    description: row.description,
    linkedMemberIds,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
  };
}
