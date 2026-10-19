import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { GalleryImage } from "@/types/gallery";
import type { Member } from "@/types/member";
import { ImageLightbox } from "./ImageLightbox";

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

const IMAGE: GalleryImage = {
  id: "image-1",
  imageData: "data:image/png;base64,abc",
  title: "Portrait",
  description: null,
  linkedMemberIds: [MEMBER.id],
  memberLinks: [{ memberId: MEMBER.id, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
  unknownFaces: [],
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

describe("ImageLightbox", () => {
  beforeEach(() => {
    useMemberStore.setState({ members: [MEMBER] });
    useMemberSheetStore.setState({ openSheets: {} });
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "viewer" },
    });
  });

  it("opens the profile of a linked person", () => {
    const onClose = vi.fn();
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));
    expect(onClose).toHaveBeenCalled();
    expect(useMemberSheetStore.getState().openSheets["tree-1"]).toEqual({
      memberId: MEMBER.id,
      tab: "identity",
      mode: "view",
    });
  });

  it("shows the linked people and their face regions", () => {
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={vi.fn()} />);

    expect(screen.getByText("Linked people:")).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
    expect(screen.getByLabelText("Face tag for Ada Lovelace")).toBeVisible();
  });

  it("shows unknown-person tags read-only", () => {
    const withUnknownFace: GalleryImage = {
      ...IMAGE,
      unknownFaces: [
        {
          id: "face-1",
          galleryImageId: IMAGE.id,
          x: 0.5,
          y: 0.5,
          w: 0.2,
          h: 0.2,
          taskId: "task-1",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    };

    render(
      <ImageLightbox
        images={[withUnknownFace]}
        startIndex={0}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Unknown person")).toBeVisible();
    expect(screen.getAllByText("Unknown person").length).toBeGreaterThan(0);
  });
});
