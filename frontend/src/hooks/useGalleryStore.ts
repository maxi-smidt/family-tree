import { create } from "zustand";
import { GalleryImage } from "@/types/gallery";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface GalleryState {
  galleryImages: GalleryImage[];
  refreshGalleryImages: (treeId?: string) => Promise<void>;
  addGalleryImage: (
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
  ) => Promise<void>;
  updateGalleryImage: (
    id: string,
    changes: Partial<GalleryImage>,
  ) => Promise<void>;
  deleteGalleryImage: (id: string) => Promise<void>;
  clear: () => void;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  galleryImages: [],

  refreshGalleryImages: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ galleryImages: [] });
      return;
    }

    const [imagesResult, linksResult] = await Promise.all([
      TreeService.getGalleryImages(treeId),
      TreeService.getGalleryMemberLinks(treeId),
    ]);

    if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight — drop stale data

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
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Member links are created in the same request (image.linkedMemberIds).
    await TreeService.addGalleryImage(treeId, id, image, now);

    await get().refreshGalleryImages(treeId);
  },

  updateGalleryImage: async (id: string, changes: Partial<GalleryImage>) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const { linkedMemberIds } = changes;

    await TreeService.updateGalleryImage(treeId, id, changes);

    if (linkedMemberIds) {
      await TreeService.setGalleryImageLinks(treeId, id, linkedMemberIds);
    }

    await get().refreshGalleryImages(treeId);
  },

  deleteGalleryImage: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeGalleryImage(treeId, id);
    await get().refreshGalleryImages(treeId);
  },

  clear: () => set({ galleryImages: [] }),
}));
