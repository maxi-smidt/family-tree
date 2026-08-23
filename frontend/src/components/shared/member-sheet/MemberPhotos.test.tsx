import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { GalleryImage, GalleryImageDB } from "@/types/gallery";
import type { Member } from "@/types/member";
import type { Workspace } from "@/types/workspace";
import { MemberPhotos } from "./MemberPhotos";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const TREE: Workspace = { id: "tree-1", name: "Workspace", role: "owner" };
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

type AddGalleryImage = ReturnType<typeof useGalleryStore.getState>["addGalleryImage"];

describe("MemberPhotos", () => {
  let addGalleryImage: AddGalleryImage;

  beforeEach(() => {
    vi.clearAllMocks();
    // The real action uploads then refreshes galleryImages from the server;
    // this fake mirrors just the observable effect MemberPhotos depends on —
    // the new image appearing in store state right after the promise resolves.
    addGalleryImage = vi.fn(
      async ({ linkedMemberIds }: { linkedMemberIds: string[] }) => {
        const id = "uploaded-image-1";
        const image: GalleryImage = {
          ...IMAGE,
          id,
          linkedMemberIds,
          memberLinks: linkedMemberIds.map((memberId) => ({
            memberId,
            x: null,
            y: null,
            w: null,
            h: null,
          })),
          unknownFaces: [],
        };
        useGalleryStore.setState((state) => ({
          galleryImages: [...state.galleryImages, image],
        }));
        return id;
      },
    );
    useGalleryStore.setState({
      galleryImages: [],
      initialized: false,
      addGalleryImage,
    });
    useMemberStore.setState({ members: [MEMBER] });
    useWorkspaceStore.setState({ selectedTree: TREE });
  });

  it("opens face tagging after an edit-view photo upload", async () => {
    const { container } = render(<MemberPhotos member={MEMBER} />);
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
    expect(addGalleryImage).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        linkedMemberIds: [MEMBER.id],
        title: "portrait",
      }),
    );
  });
});
