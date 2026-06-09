import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "./useGalleryStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { GalleryImageDB } from "@/types/gallery";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");

const TREE_ID = "tree-gal";
const TREE: Tree = { id: TREE_ID, name: "Gal Tree", role: "owner" };

const IMAGE_DB: GalleryImageDB = {
  id: "img1",
  imageData: "data:image/png;base64,abc",
  title: "Test Photo",
  description: null,
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  useGalleryStore.setState({ galleryImages: [] });
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useGalleryStore — refreshGalleryImages", () => {
  it("clears images when no tree is selected", async () => {
    useGalleryStore.setState({ galleryImages: [{ id: "stale" } as never] });

    await useGalleryStore.getState().refreshGalleryImages();

    expect(useGalleryStore.getState().galleryImages).toHaveLength(0);
    expect(TreeService.getGalleryImages).not.toHaveBeenCalled();
  });

  it("fetches images and attaches member link IDs", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getGalleryImages).mockResolvedValue([IMAGE_DB]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([
      { gallery_image_id: "img1", member_id: "m1" },
      { gallery_image_id: "img1", member_id: "m2" },
    ]);

    await useGalleryStore.getState().refreshGalleryImages();

    const images = useGalleryStore.getState().galleryImages;
    expect(images).toHaveLength(1);
    expect(images[0].id).toBe("img1");
    expect(images[0].linkedMemberIds).toEqual(["m1", "m2"]);
    expect(images[0].title).toBe("Test Photo");
  });
});

describe("useGalleryStore — addGalleryImage", () => {
  it("calls TreeService.addGalleryImage then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.addGalleryImage).mockResolvedValue(undefined);
    vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore.getState().addGalleryImage({
      imageData: "data:image/png;base64,xyz",
      title: "New Photo",
      description: null,
      linkedMemberIds: ["m3"],
    });

    expect(TreeService.addGalleryImage).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      expect.objectContaining({ title: "New Photo" }),
      expect.any(String),
    );
    expect(TreeService.getGalleryImages).toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    await useGalleryStore.getState().addGalleryImage({
      imageData: "data:image/png;base64,xyz",
      title: null,
      description: null,
      linkedMemberIds: [],
    });

    expect(TreeService.addGalleryImage).not.toHaveBeenCalled();
  });
});

describe("useGalleryStore — updateGalleryImage", () => {
  it("calls TreeService.updateGalleryImage and setGalleryImageLinks when links change", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.updateGalleryImage).mockResolvedValue(undefined);
    vi.mocked(TreeService.setGalleryImageLinks).mockResolvedValue(undefined);
    vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore
      .getState()
      .updateGalleryImage("img1", {
        title: "Renamed",
        linkedMemberIds: ["m4"],
      });

    expect(TreeService.updateGalleryImage).toHaveBeenCalledWith(
      TREE_ID,
      "img1",
      expect.objectContaining({ title: "Renamed" }),
    );
    expect(TreeService.setGalleryImageLinks).toHaveBeenCalledWith(
      TREE_ID,
      "img1",
      ["m4"],
    );
  });

  it("does not call setGalleryImageLinks when linkedMemberIds is not in changes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.updateGalleryImage).mockResolvedValue(undefined);
    vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore
      .getState()
      .updateGalleryImage("img1", { title: "Title only" });

    expect(TreeService.setGalleryImageLinks).not.toHaveBeenCalled();
  });
});

describe("useGalleryStore — deleteGalleryImage", () => {
  it("calls TreeService.removeGalleryImage then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.removeGalleryImage).mockResolvedValue(undefined);
    vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore.getState().deleteGalleryImage("img1");

    expect(TreeService.removeGalleryImage).toHaveBeenCalledWith(
      TREE_ID,
      "img1",
    );
    expect(TreeService.getGalleryImages).toHaveBeenCalled();
  });
});
