import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import type { GalleryImage } from "@/types/gallery";
import type { Member } from "@/types/member";
import { ImageSheet } from "./ImageSheet";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

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
  createdAt: "2024-01-01",
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
  beforeEach(() => {
    vi.clearAllMocks();
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
    useMemberStore.setState({ members: [MEMBER, UNLINKED_MEMBER] });
    useTreeStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
    });
    useGalleryStore.setState({
      galleryImages: [],
      updateGalleryImage: vi.fn().mockResolvedValue(undefined),
      addUnknownFace: vi.fn().mockResolvedValue(undefined),
      resolveUnknownFace: vi.fn().mockResolvedValue(undefined),
      removeUnknownFace: vi.fn().mockResolvedValue(undefined),
    });
    useAuthStore.setState({ features: [] });
  });

  it("clears the photo date with the partial date picker and saves it as null", async () => {
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);

    const dateInput = screen.getByLabelText(i18n.t("common.date-input-hint"));
    fireEvent.focus(dateInput);
    fireEvent.change(dateInput, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const { updateGalleryImage } = useGalleryStore.getState();
    await vi.waitFor(() => {
      expect(updateGalleryImage).toHaveBeenCalled();
    });
    const call = vi.mocked(updateGalleryImage).mock.calls[0];
    expect(call[0]).toBe(IMAGE.id);
    expect(call[1]).toEqual(expect.objectContaining({ createdAt: null }));
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
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);

    fireEvent.click(screen.getByRole("button", { name: "Tag faces" }));
    const overlay = document.querySelector(".cursor-crosshair") as Element;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(overlay, { clientX: 40, clientY: 40 });

    fireEvent.click(
      screen.getByRole("button", { name: "Mark as unknown person" }),
    );

    const { addUnknownFace } = useGalleryStore.getState();
    await vi.waitFor(() => {
      expect(addUnknownFace).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(addUnknownFace).mock.calls[0];
    expect(call[0]).toBe(IMAGE.id);
    expect(call[1].x).toBeCloseTo(0.1);
    expect(call[1].y).toBeCloseTo(0.1);
    expect(call[1].w).toBeCloseTo(0.3);
    expect(call[1].h).toBeCloseTo(0.3);
    expect(call[2].title).toContain("Portrait");
  });

  it("resolves an unknown face to a member", async () => {
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

    const { resolveUnknownFace } = useGalleryStore.getState();
    await vi.waitFor(() => {
      expect(resolveUnknownFace).toHaveBeenCalledWith(
        "face-1",
        UNLINKED_MEMBER.id,
      );
    });
  });

  it("deletes an unknown face", async () => {
    render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE_WITH_UNKNOWN_FACE} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete unknown-person tag" }),
    );

    const { removeUnknownFace } = useGalleryStore.getState();
    await vi.waitFor(() => {
      expect(removeUnknownFace).toHaveBeenCalledWith("face-1");
    });
  });
});
