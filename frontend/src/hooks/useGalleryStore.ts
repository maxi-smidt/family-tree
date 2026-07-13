import { create } from "zustand";
import { GalleryImage, GalleryImageDB } from "@/types/gallery";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { useStorageStore } from "@/hooks/useStorageStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

/** Runtime guard for data received from the gallery API. */
function isGalleryImageDB(image: unknown): image is GalleryImageDB {
  return (
    typeof image === "object" &&
    image !== null &&
    typeof (image as GalleryImageDB).id === "string" &&
    typeof (image as GalleryImageDB).imageData === "string" &&
    ((image as GalleryImageDB).title === null ||
      typeof (image as GalleryImageDB).title === "string") &&
    ((image as GalleryImageDB).description === null ||
      typeof (image as GalleryImageDB).description === "string") &&
    typeof (image as GalleryImageDB).createdAt === "string" &&
    typeof (image as GalleryImageDB).uploadedAt === "string"
  );
}

export interface AddGalleryImageOptions {
  /** When false, skip the post-add refreshGalleryImages / refreshStorageUsage /
   * invalidateActivityView. Useful for bulk uploads that batch the refresh at
   * the end. Default (undefined / true) keeps current single-upload behaviour. */
  refresh?: boolean;
}

interface GalleryState {
  galleryImages: GalleryImage[];
  initialized: boolean;
  refreshGalleryImages: (treeId?: string) => Promise<void>;
  addGalleryImage: (
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
    opts?: AddGalleryImageOptions,
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
  initialized: false,

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

    const linksByImage = new Map<string, string[]>();
    for (const link of linksResult) {
      linksByImage.set(
        link.gallery_image_id,
        (linksByImage.get(link.gallery_image_id) ?? []).concat(link.member_id),
      );
    }

    const images = imagesResult.filter(isGalleryImageDB).map((row) => {
      const linkedMemberIds = linksByImage.get(row.id) ?? [];
      return {
        ...row,
        linkedMemberIds,
      };
    });

    set({ galleryImages: images, initialized: true });
  },

  addGalleryImage: async (
    image: Omit<GalleryImage, "id" | "createdAt" | "uploadedAt">,
    opts?: AddGalleryImageOptions,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Member links are created in the same request (image.linkedMemberIds).
    await TreeService.addGalleryImage(treeId, id, image, now);

    if (opts?.refresh !== false) {
      await get().refreshGalleryImages(treeId);
      useStorageStore.getState().refreshStorageUsage();
      invalidateActivityView();
    }
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
    if ("imageData" in changes)
      useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  deleteGalleryImage: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.removeGalleryImage(treeId, id);
    await get().refreshGalleryImages(treeId);
    useStorageStore.getState().refreshStorageUsage();
    invalidateActivityView();
  },

  clear: () => set({ galleryImages: [], initialized: false }),
}));
