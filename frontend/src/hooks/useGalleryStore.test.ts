import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "./useGalleryStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { GalleryImageDB } from "@/types/gallery";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-gal";
const TREE: Workspace = { id: TREE_ID, name: "Gal Workspace", role: "owner" };

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
  useWorkspaceStore.setState({ selectedTree: undefined });
  vi.mocked(WorkspaceService.getGalleryUnknownFaces).mockResolvedValue([]);
});

describe("useGalleryStore — refreshGalleryImages", () => {
  it("clears images when no tree is selected", async () => {
    useGalleryStore.setState({ galleryImages: [{ id: "stale" } as never] });

    await useGalleryStore.getState().refreshGalleryImages();

    expect(useGalleryStore.getState().galleryImages).toHaveLength(0);
    expect(WorkspaceService.getGalleryImages).not.toHaveBeenCalled();
  });

  it("fetches images and attaches member link IDs", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([IMAGE_DB]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([
      {
        gallery_image_id: "img1",
        member_id: "m1",
        x: null,
        y: null,
        w: null,
        h: null,
      },
      {
        gallery_image_id: "img1",
        member_id: "m2",
        x: 0.1,
        y: 0.2,
        w: 0.3,
        h: 0.4,
      },
    ]);

    await useGalleryStore.getState().refreshGalleryImages();

    const images = useGalleryStore.getState().galleryImages;
    expect(images).toHaveLength(1);
    expect(images[0].id).toBe("img1");
    expect(images[0].linkedMemberIds).toEqual(["m1", "m2"]);
    expect(images[0].memberLinks).toEqual([
      { memberId: "m1", x: null, y: null, w: null, h: null },
      { memberId: "m2", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    ]);
    expect(images[0].title).toBe("Test Photo");
  });

  it("drops missing gallery-image entries returned by the API", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([
      IMAGE_DB,
      undefined as never,
    ]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore.getState().refreshGalleryImages();

    expect(useGalleryStore.getState().galleryImages).toEqual([
      expect.objectContaining({ id: IMAGE_DB.id }),
    ]);
  });

  it("keeps a gallery image whose photo-taken date is null", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([
      { ...IMAGE_DB, createdAt: null },
    ]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore.getState().refreshGalleryImages();

    expect(useGalleryStore.getState().galleryImages).toEqual([
      expect.objectContaining({ id: IMAGE_DB.id, createdAt: null }),
    ]);
  });
});

describe("useGalleryStore — addGalleryImage", () => {
  const FILE = new File([new Uint8Array([1, 2, 3])], "photo.png", {
    type: "image/png",
  });

  it("streams the file via WorkspaceService.uploadGalleryImage then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.uploadGalleryImage).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);

    const imageId = await useGalleryStore.getState().addGalleryImage({
      file: FILE,
      title: "New Photo",
      description: null,
      linkedMemberIds: ["m3"],
    });

    expect(imageId).toEqual(expect.any(String));
    expect(WorkspaceService.uploadGalleryImage).toHaveBeenCalledWith(
      TREE_ID,
      imageId,
      FILE,
      expect.objectContaining({ title: "New Photo", memberIds: ["m3"] }),
      expect.any(String),
    );
    expect(WorkspaceService.getGalleryImages).toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    const imageId = await useGalleryStore.getState().addGalleryImage({
      file: FILE,
      title: null,
      description: null,
      linkedMemberIds: [],
    });

    expect(imageId).toBeUndefined();
    expect(WorkspaceService.uploadGalleryImage).not.toHaveBeenCalled();
  });
});

describe("useGalleryStore — updateGalleryImage", () => {
  it("calls WorkspaceService.updateGalleryImage and setGalleryImageLinks when links change", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.updateGalleryImage).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setGalleryImageLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore.getState().updateGalleryImage("img1", {
      title: "Renamed",
      memberLinks: [{ memberId: "m4", x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
    });

    expect(WorkspaceService.updateGalleryImage).toHaveBeenCalledWith(
      TREE_ID,
      "img1",
      expect.objectContaining({ title: "Renamed" }),
    );
    expect(WorkspaceService.setGalleryImageLinks).toHaveBeenCalledWith(
      TREE_ID,
      "img1",
      [{ memberId: "m4", x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
    );
  });

  it("does not call setGalleryImageLinks when linkedMemberIds is not in changes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.updateGalleryImage).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore
      .getState()
      .updateGalleryImage("img1", { title: "Title only" });

    expect(WorkspaceService.setGalleryImageLinks).not.toHaveBeenCalled();
  });
});

describe("useGalleryStore — deleteGalleryImage", () => {
  it("calls WorkspaceService.removeGalleryImage then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.removeGalleryImage).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);

    await useGalleryStore.getState().deleteGalleryImage("img1");

    expect(WorkspaceService.removeGalleryImage).toHaveBeenCalledWith(
      TREE_ID,
      "img1",
    );
    expect(WorkspaceService.getGalleryImages).toHaveBeenCalled();
  });
});

describe("useGalleryStore — stale-write guard", () => {
  it("does not write fetched data when the tree changed mid-flight", async () => {
    let resolve!: (v: GalleryImageDB[]) => void;
    const pending = new Promise<GalleryImageDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getGalleryImages).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useGalleryStore.getState().refreshGalleryImages(TREE_ID);
    // user switches away before the fetch resolves
    useWorkspaceStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([IMAGE_DB]);
    await p;

    expect(useGalleryStore.getState().galleryImages).toHaveLength(0); // stale data dropped
  });

  it("does not write fetched data after disconnect", async () => {
    let resolve!: (v: GalleryImageDB[]) => void;
    const pending = new Promise<GalleryImageDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getGalleryImages).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useGalleryStore.getState().refreshGalleryImages(TREE_ID);
    // user disconnects before the fetch resolves
    useWorkspaceStore.setState({ selectedTree: undefined });
    resolve([IMAGE_DB]);
    await p;

    expect(useGalleryStore.getState().galleryImages).toHaveLength(0); // stale data dropped
  });

  it("writes data when the explicit workspaceId is still active", async () => {
    let resolve!: (v: GalleryImageDB[]) => void;
    const pending = new Promise<GalleryImageDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getGalleryImages).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useGalleryStore.getState().refreshGalleryImages(TREE_ID);
    resolve([IMAGE_DB]);
    await p;

    expect(useGalleryStore.getState().galleryImages).toHaveLength(1);
    expect(useGalleryStore.getState().galleryImages[0].id).toBe("img1");
  });

  it("clear() empties the galleryImages slice", () => {
    useGalleryStore.setState({ galleryImages: [{ id: "g1" } as never] });

    useGalleryStore.getState().clear();

    expect(useGalleryStore.getState().galleryImages).toHaveLength(0);
  });
});

describe("useGalleryStore — unknown faces", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryMemberLinks).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getGalleryUnknownFaces).mockResolvedValue([]);
  });

  it("addUnknownFace streams a face + task, then refreshes", async () => {
    vi.mocked(WorkspaceService.addGalleryUnknownFace).mockResolvedValue(
      undefined as never,
    );

    await useGalleryStore
      .getState()
      .addUnknownFace(
        "img1",
        { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        { title: "Who is this?", notes: null },
      );

    expect(WorkspaceService.addGalleryUnknownFace).toHaveBeenCalledWith(
      TREE_ID,
      "img1",
      expect.objectContaining({
        x: 0.1,
        y: 0.2,
        w: 0.3,
        h: 0.4,
        taskTitle: "Who is this?",
        taskNotes: null,
      }),
    );
    expect(WorkspaceService.getGalleryImages).toHaveBeenCalled();
  });

  it("updateUnknownFace calls WorkspaceService and refreshes", async () => {
    vi.mocked(WorkspaceService.updateGalleryUnknownFace).mockResolvedValue(
      undefined as never,
    );

    await useGalleryStore
      .getState()
      .updateUnknownFace("face1", { x: 0.5, y: 0.5, w: 0.1, h: 0.1 });

    expect(WorkspaceService.updateGalleryUnknownFace).toHaveBeenCalledWith(
      TREE_ID,
      "face1",
      { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
    );
    expect(WorkspaceService.getGalleryImages).toHaveBeenCalled();
  });

  it("resolveUnknownFace calls WorkspaceService and refreshes", async () => {
    vi.mocked(WorkspaceService.resolveGalleryUnknownFace).mockResolvedValue(
      undefined,
    );

    await useGalleryStore.getState().resolveUnknownFace("face1", "m1");

    expect(WorkspaceService.resolveGalleryUnknownFace).toHaveBeenCalledWith(
      TREE_ID,
      "face1",
      "m1",
    );
    expect(WorkspaceService.getGalleryImages).toHaveBeenCalled();
  });

  it("removeUnknownFace calls WorkspaceService and refreshes", async () => {
    vi.mocked(WorkspaceService.removeGalleryUnknownFace).mockResolvedValue(
      undefined,
    );

    await useGalleryStore.getState().removeUnknownFace("face1");

    expect(WorkspaceService.removeGalleryUnknownFace).toHaveBeenCalledWith(
      TREE_ID,
      "face1",
    );
    expect(WorkspaceService.getGalleryImages).toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    useWorkspaceStore.setState({ selectedTree: undefined });

    await useGalleryStore
      .getState()
      .addUnknownFace(
        "img1",
        { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        { title: null, notes: null },
      );

    expect(WorkspaceService.addGalleryUnknownFace).not.toHaveBeenCalled();
  });

  it("attaches fetched unknown faces to their gallery image", async () => {
    vi.mocked(WorkspaceService.getGalleryImages).mockResolvedValue([
      {
        id: "img1",
        imageData: "data:image/png;base64,abc",
        title: "Test",
        description: null,
        createdAt: "2024-01-01T00:00:00Z",
        uploadedAt: "2024-01-01T00:00:00Z",
      },
    ]);
    vi.mocked(WorkspaceService.getGalleryUnknownFaces).mockResolvedValue([
      {
        id: "face1",
        gallery_image_id: "img1",
        x: 0.1,
        y: 0.2,
        w: 0.3,
        h: 0.4,
        task_id: "task1",
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    await useGalleryStore.getState().refreshGalleryImages();

    const image = useGalleryStore.getState().galleryImages[0];
    expect(image.unknownFaces).toEqual([
      {
        id: "face1",
        galleryImageId: "img1",
        x: 0.1,
        y: 0.2,
        w: 0.3,
        h: 0.4,
        taskId: "task1",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ]);
  });
});
