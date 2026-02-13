import { create } from "zustand";
import { GalleryImage } from "@/types/gallery";
import { DatabaseService } from "@/services/DatabaseService";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";

interface GalleryState {
  galleryImages: GalleryImage[];
  refreshGalleryImages: () => Promise<void>;
  addGalleryImage: (
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
  ) => Promise<void>;
  updateGalleryImage: (
    id: string,
    changes: Partial<GalleryImage>,
  ) => Promise<void>;
  deleteGalleryImage: (id: string) => Promise<void>;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  galleryImages: [],

  refreshGalleryImages: async () => {
    const db = useDatabaseStore.getState().db;
    if (!db) {
      set({ galleryImages: [] });
      return;
    }

    const imagesResult = await DatabaseService.getGalleryImages(db);
    const linksResult = await DatabaseService.getGalleryMemberLinks(db);

    const images = imagesResult.map((row) => {
      const linkedMemberIds = linksResult
        .filter((link) => link.gallery_image_id === row.id)
        .map((link) => link.member_id);
      return {
        ...row,
        linkedMemberIds,
      };
    });

    set({ galleryImages: images });
  },

  addGalleryImage: async (
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
  ) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await DatabaseService.addGalleryImage(db, id, image, now);

    if (image.linkedMemberIds && image.linkedMemberIds.length > 0) {
      for (const memberId of image.linkedMemberIds) {
        await DatabaseService.linkGalleryImageToMember(db, id, memberId);
      }
    }

    await get().refreshGalleryImages();
  },

  updateGalleryImage: async (id: string, changes: Partial<GalleryImage>) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;

    const { linkedMemberIds } = changes;

    await DatabaseService.updateGalleryImage(db, id, changes);

    if (linkedMemberIds) {
      await DatabaseService.removeGalleryImageLinks(db, id);
      for (const memberId of linkedMemberIds) {
        await DatabaseService.linkGalleryImageToMember(db, id, memberId);
      }
    }

    await get().refreshGalleryImages();
  },

  deleteGalleryImage: async (id: string) => {
    const db = useDatabaseStore.getState().db;
    if (!db) return;
    await DatabaseService.removeGalleryImage(db, id);
    await get().refreshGalleryImages();
  },
}));
