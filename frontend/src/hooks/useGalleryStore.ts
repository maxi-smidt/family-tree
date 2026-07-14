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

/** The raw picked file plus metadata for a new gallery image. The file is
 *  streamed as multipart form-data — no base64 is retained in store state. */
export interface NewGalleryImage {
  file: File;
  title: string | null;
  description: string | null;
  linkedMemberIds: string[];
}

interface GalleryState {
  galleryImages: GalleryImage[];
  initialized: boolean;
  refreshGalleryImages: (treeId?: string) => Promise<void>;
  addGalleryImage: (
    image: NewGalleryImage,
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
    image: NewGalleryImage,
    opts?: AddGalleryImageOptions,
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // The file streams as multipart; member links are created in the same
    // request (image.linkedMemberIds).
    await TreeService.uploadGalleryImage(
      treeId,
      id,
      image.file,
      {
        title: image.title,
        description: image.description,
        memberIds: image.linkedMemberIds ?? [],
      },
      now,
    );

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
    // Editing only touches metadata/links — image bytes (and therefore storage
    // usage) can't change here, so no storage refresh is needed.
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
