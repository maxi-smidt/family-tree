import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { TreeService } from "@/services/TreeService";
import type { GalleryImage, GalleryImageDB } from "@/types/gallery";
import type { Member } from "@/types/member";
import type { Tree } from "@/types/tree";
import { MemberPhotos } from "./MemberPhotos";

vi.mock("@/services/TreeService");
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error -- test-only polyfill for Radix popovers
global.ResizeObserver = MockResizeObserver;

const TREE: Tree = { id: "tree-1", name: "Tree", role: "owner" };
const MEMBER: Member = {
  id: "member-1",
  gender: "f",
  academicTitle: null,
  firstName: "Ada",
  middleNames: null,
  baptismalName: null,
  lastName: "Lovelace",
  maidenName: null,
  imageData: null,
  deceased: false,
  adopted: false,
  date: { birth: "1815-12-10", death: null },
  parents: { paternalParent: null, maternalParent: null },
  additionalData: null,
  birthplace: null,
  hometown: null,
  cemetery: null,
  placesLived: [],
  isCollapsed: false,
  position: { x: 0, y: 0 },
};

const IMAGE: GalleryImageDB = {
  id: "",
  imageData: "data:image/png;base64,abc",
  title: "Portrait",
  description: null,
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

describe("MemberPhotos", () => {
  beforeEach(async () => {
    let uploadedImageId = "";

    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    await i18n.changeLanguage("en");
    useGalleryStore.setState({ galleryImages: [], initialized: false });
    useMemberStore.setState({ members: [MEMBER] });
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.uploadGalleryImage).mockImplementation(
      async (_treeId, id) => {
        uploadedImageId = id;
        return undefined as never;
      },
    );
    vi.mocked(TreeService.getGalleryImages).mockImplementation(async () => [
      { ...IMAGE, id: uploadedImageId },
    ]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockImplementation(
      async () => [
        {
          gallery_image_id: uploadedImageId,
          member_id: MEMBER.id,
          x: null,
          y: null,
          w: null,
          h: null,
        },
      ],
    );
    vi.mocked(TreeService.getGalleryUnknownFaces).mockResolvedValue([]);
  });

  it("opens face tagging after an edit-view photo upload", async () => {
    const { container } = render(
      <MemberPhotos member={MEMBER} onSelectProfilePicture={vi.fn()} />,
    );
    const fileInput = container.querySelector('input[type="file"]');
    const file = new File([new Uint8Array([1, 2, 3])], "portrait.png", {
      type: "image/png",
    });

    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(
      await screen.findByRole("button", { name: "Done tagging" }),
    ).toBeInTheDocument();
    expect(TreeService.uploadGalleryImage).toHaveBeenCalledWith(
      TREE.id,
      expect.any(String),
      file,
      expect.objectContaining({ memberIds: [MEMBER.id], title: "portrait" }),
      expect.any(String),
    );
  });

  it("calls onSelectProfilePicture when a linked photo is chosen as the avatar", async () => {
    const linkedImage: GalleryImage = {
      id: "image-1",
      imageData: "data:image/png;base64,abc",
      title: "Portrait",
      description: null,
      linkedMemberIds: [MEMBER.id],
      memberLinks: [
        { memberId: MEMBER.id, x: null, y: null, w: null, h: null },
      ],
      unknownFaces: [],
      createdAt: "2024-01-01T00:00:00Z",
      uploadedAt: "2024-01-01T00:00:00Z",
    };
    useGalleryStore.setState({
      galleryImages: [linkedImage],
      initialized: true,
    });
    const onSelectProfilePicture = vi.fn();

    render(
      <MemberPhotos
        member={MEMBER}
        onSelectProfilePicture={onSelectProfilePicture}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Use as profile picture" }),
    );

    expect(onSelectProfilePicture).toHaveBeenCalledWith(linkedImage);
  });
});
