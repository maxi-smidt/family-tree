import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { TreeService } from "@/services/TreeService";
import type { GalleryImage } from "@/types/gallery";
import type { Member } from "@/types/member";
import { ImageSheet } from "./ImageSheet";

vi.mock("@/services/TreeService");
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error -- test-only polyfill for Radix popovers
global.ResizeObserver = MockResizeObserver;

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

const UNLINKED_MEMBER: Member = {
  ...MEMBER,
  id: "member-2",
  firstName: "Alan",
  lastName: "Turing",
};

const IMAGE: GalleryImage = {
  id: "image-1",
  imageData: "data:image/png;base64,abc",
  title: "Portrait",
  description: null,
  linkedMemberIds: [MEMBER.id],
  memberLinks: [{ memberId: MEMBER.id, x: null, y: null, w: null, h: null }],
  unknownFaces: [],
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

const IMAGE_WITH_UNKNOWN_FACE: GalleryImage = {
  ...IMAGE,
  unknownFaces: [
    {
      id: "face-1",
      galleryImageId: IMAGE.id,
      x: 0.4,
      y: 0.4,
      w: 0.2,
      h: 0.2,
      taskId: "task-1",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
};

describe("ImageSheet", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => {},
    }));
    await i18n.changeLanguage("en");
    useMemberStore.setState({ members: [MEMBER, UNLINKED_MEMBER] });
    useTreeStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
    });
    useGalleryStore.setState({ galleryImages: [] });
    useAuthStore.setState({ features: [] });
    vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);
    vi.mocked(TreeService.getGalleryUnknownFaces).mockResolvedValue([]);
  });

  it("hides already-linked people from candidates while keeping their link visible", async () => {
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);

    expect(
      screen.getByRole("button", { name: "Remove Ada Lovelace" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox"));

    expect(
      await screen.findByRole("option", { name: /Alan Turing/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Ada Lovelace/ }),
    ).not.toBeInTheDocument();
  });

  it("renders an unknown-face region with its localized label", () => {
    render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE_WITH_UNKNOWN_FACE} />,
    );

    expect(screen.getByLabelText("Unknown person")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown person").length).toBeGreaterThan(0);
  });

  it("offers 'Mark as unknown person' only when research_tasks is enabled", () => {
    const { rerender } = render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tag faces" }));
    const overlay = document.querySelector(".cursor-crosshair") as Element;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(overlay, { clientX: 40, clientY: 40 });

    expect(
      screen.queryByRole("button", { name: "Mark as unknown person" }),
    ).not.toBeInTheDocument();

    useAuthStore.setState({ features: ["research_tasks"] });
    rerender(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);

    expect(
      screen.getByRole("button", { name: "Mark as unknown person" }),
    ).toBeInTheDocument();
  });

  it("persists a new unknown-face tag immediately when marked", async () => {
    useAuthStore.setState({ features: ["research_tasks"] });
    vi.mocked(TreeService.addGalleryUnknownFace).mockResolvedValue(
      undefined as never,
    );
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);

    fireEvent.click(screen.getByRole("button", { name: "Tag faces" }));
    const overlay = document.querySelector(".cursor-crosshair") as Element;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(overlay, { clientX: 40, clientY: 40 });

    fireEvent.click(
      screen.getByRole("button", { name: "Mark as unknown person" }),
    );

    await vi.waitFor(() => {
      expect(TreeService.addGalleryUnknownFace).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(TreeService.addGalleryUnknownFace).mock.calls[0];
    expect(call[0]).toBe("tree-1");
    expect(call[1]).toBe(IMAGE.id);
    expect(call[2].x).toBeCloseTo(0.1);
    expect(call[2].y).toBeCloseTo(0.1);
    expect(call[2].w).toBeCloseTo(0.3);
    expect(call[2].h).toBeCloseTo(0.3);
    expect(call[2].taskTitle).toContain("Portrait");
  });

  it("resolves an unknown face to a member", async () => {
    vi.mocked(TreeService.resolveGalleryUnknownFace).mockResolvedValue(
      undefined,
    );
    render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE_WITH_UNKNOWN_FACE} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Identify this person" }),
    );
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByRole("option", { name: /Alan Turing/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm identification" }),
    );

    await vi.waitFor(() => {
      expect(TreeService.resolveGalleryUnknownFace).toHaveBeenCalledWith(
        "tree-1",
        "face-1",
        UNLINKED_MEMBER.id,
      );
    });
  });

  it("deletes an unknown face", async () => {
    vi.mocked(TreeService.removeGalleryUnknownFace).mockResolvedValue(
      undefined,
    );
    render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE_WITH_UNKNOWN_FACE} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete unknown-person tag" }),
    );

    await vi.waitFor(() => {
      expect(TreeService.removeGalleryUnknownFace).toHaveBeenCalledWith(
        "tree-1",
        "face-1",
      );
    });
  });
});
