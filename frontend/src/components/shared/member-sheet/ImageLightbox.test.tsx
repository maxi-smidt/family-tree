import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { downloadMedia } from "@/hooks/useMediaUrl";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { GalleryImage } from "@/types/gallery";
import type { Member } from "@/types/member";
import { ImageLightbox } from "./ImageLightbox";

vi.mock("@/hooks/useMediaUrl", () => ({
  useMediaUrl: (src: string | null | undefined) => src,
  downloadMedia: vi.fn(),
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

const IMAGE: GalleryImage = {
  id: "image-1",
  imageData: "data:image/png;base64,abc",
  title: "Portrait",
  description: "A portrait of Ada.",
  linkedMemberIds: [MEMBER.id],
  memberLinks: [{ memberId: MEMBER.id, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
  unknownFaces: [],
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

describe("ImageLightbox", () => {
  beforeEach(() => {
    vi.mocked(downloadMedia).mockReset().mockResolvedValue(undefined);
    useGalleryStore.setState({
      galleryImages: [IMAGE],
      updateGalleryImage: vi.fn().mockResolvedValue(undefined),
    });
    useMemberStore.setState({ members: [MEMBER] });
    useMemberSheetStore.setState({ openSheets: {} });
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "viewer" },
    });
  });

  it("opens the profile of a linked person", () => {
    const onClose = vi.fn();
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(onClose).toHaveBeenCalled();
    expect(useMemberSheetStore.getState().openSheets["tree-1"]).toEqual({
      memberId: MEMBER.id,
      tab: "identity",
      mode: "view",
    });
  });

  it("reveals a face region on hovering or focusing its member pill or face", () => {
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={vi.fn()} />);

    expect(screen.queryByText("Linked people:")).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "Linked people" }),
      ).getByRole("button", { name: "Open Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
    expect(screen.getByText("A portrait of Ada.")).toBeVisible();
    const face = screen.getByLabelText("Face tag for Ada Lovelace");
    const chip = screen.getByRole("button", { name: "Open Ada Lovelace" });
    expect(chip).toHaveTextContent("1815");
    expect(face).toHaveClass("opacity-0");
    fireEvent.mouseEnter(chip.parentElement!);
    expect(face).toHaveClass("opacity-100");
    fireEvent.mouseLeave(chip.parentElement!);
    expect(face).toHaveClass("opacity-0");
    fireEvent.mouseEnter(face);
    expect(face).toHaveClass("opacity-100");
    fireEvent.mouseLeave(face);
    expect(face).toHaveClass("opacity-0");
    fireEvent.focus(chip);
    expect(face).toHaveClass("opacity-100");
    fireEvent.blur(chip);
    expect(face).toHaveClass("opacity-0");
    fireEvent.focus(face);
    expect(face).toHaveClass("opacity-100");
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

    const face = screen.getByLabelText("Unknown person");
    expect(face).toHaveClass("opacity-0");
    fireEvent.mouseEnter(face);
    expect(face).toHaveClass("opacity-100");
    fireEvent.mouseLeave(face);
    expect(face).toHaveClass("opacity-0");
    expect(screen.getAllByText("Unknown person").length).toBeGreaterThan(0);
  });
  it("navigates with buttons and arrow keys, clears hovered tags, and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <ImageLightbox
        images={[
          IMAGE,
          {
            ...IMAGE,
            id: "second",
            title: "Second photo",
            description: "Second description",
          },
        ]}
        startIndex={1}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("heading", { name: "Second photo" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("heading", { name: "Portrait" })).toBeVisible();
    fireEvent.mouseEnter(screen.getByLabelText("Face tag for Ada Lovelace"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(screen.getByRole("heading", { name: "Second photo" })).toBeVisible();
    expect(screen.getByLabelText("Face tag for Ada Lovelace")).toHaveClass(
      "opacity-0",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Portrait" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("handles an empty image collection", () => {
    render(<ImageLightbox images={[]} startIndex={0} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses empty background but protects the photo, captions, people and controls with a 24px margin", () => {
    const onClose = vi.fn();
    render(
      <ImageLightbox
        images={[IMAGE, { ...IMAGE, id: "second" }]}
        startIndex={0}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const photo = screen.getByRole("img", { name: "Portrait" });
    const next = screen.getByRole("button", { name: "Next image" });
    const close = screen.getByRole("button", { name: "Close image" });
    const regions = [
      [photo.parentElement!, new DOMRect(300, 200, 400, 300)],
      [screen.getByRole("heading"), new DOMRect(420, 530, 160, 32)],
      [screen.getByText("A portrait of Ada."), new DOMRect(400, 570, 200, 24)],
      [screen.getByText("1 / 2"), new DOMRect(480, 610, 40, 20)],
      [screen.getByRole("complementary"), new DOMRect(740, 200, 180, 200)],
      [close.parentElement!, new DOMRect(800, 16, 128, 40)],
      [next, new DOMRect(940, 450, 40, 40)],
    ] as const;
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return (
          regions.find(([element]) => element === this)?.[1] ??
          originalBounds.call(this)
        );
      });
    try {
      fireEvent.click(photo, { clientX: 500, clientY: 350 });
      fireEvent.click(screen.getByRole("heading"));
      fireEvent.click(screen.getByText("A portrait of Ada."));
      fireEvent.click(screen.getByRole("complementary"));
      fireEvent.click(screen.getByLabelText("Face tag for Ada Lovelace"));
      for (const [, region] of regions) {
        fireEvent.click(dialog, {
          clientX: region.left - 24,
          clientY: region.top + region.height / 2,
        });
      }
      expect(onClose).not.toHaveBeenCalled();

      // A gesture that starts on the photo must not dismiss on release outside.
      fireEvent.pointerDown(photo, { clientX: 500, clientY: 350 });
      fireEvent.click(dialog, { clientX: 100, clientY: 100 });
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.pointerDown(dialog, { clientX: 100, clientY: 100 });
      fireEvent.click(dialog, { clientX: 100, clientY: 100 });
      expect(onClose).toHaveBeenCalledOnce();
      fireEvent.click(dialog.querySelector(".image-viewer-layout")!, {
        clientX: 275,
        clientY: 350,
      });
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      bounds.mockRestore();
    }
  });

  it("downloads the currently navigated photo with its stored format without closing the viewer", async () => {
    const onClose = vi.fn();
    const secondImage = {
      ...IMAGE,
      id: "second",
      title: "Family portrait.jpg",
      imageData: "/api/media/tree-1/second.webp",
    };
    render(
      <ImageLightbox
        images={[IMAGE, secondImage]}
        startIndex={0}
        onClose={onClose}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /fullscreen/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download photo" }));
    });
    expect(downloadMedia).toHaveBeenCalledExactlyOnceWith(
      secondImage.imageData,
      "Family portrait.webp",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the image ID and data URL format for untitled photos", async () => {
    render(
      <ImageLightbox
        images={[{ ...IMAGE, title: null }]}
        startIndex={0}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download photo" }));
    });
    expect(downloadMedia).toHaveBeenCalledWith(IMAGE.imageData, "image-1.png");
  });

  it("prevents duplicate downloads while the photo is being fetched", async () => {
    let complete!: () => void;
    vi.mocked(downloadMedia).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Download photo" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(downloadMedia).toHaveBeenCalledOnce();
    await act(async () => complete());
    expect(button).toBeEnabled();
  });

  it("reports failed downloads and allows retrying without closing the viewer", async () => {
    vi.mocked(downloadMedia).mockRejectedValueOnce(new Error("Failed"));
    const error = vi.spyOn(toast, "error").mockReturnValue("download-error");
    const onClose = vi.fn();
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={onClose} />);
    try {
      const button = screen.getByRole("button", { name: "Download photo" });
      await act(async () => fireEvent.click(button));
      expect(error).toHaveBeenCalledWith(
        "Could not download the photo. Please try again.",
      );
      expect(button).toBeEnabled();
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => fireEvent.click(button));
      expect(downloadMedia).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });

  it("opens editing beside the currently navigated photo and returns to viewing after saving", async () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    const secondImage = { ...IMAGE, id: "second", title: "Second photo" };
    const onClose = vi.fn();
    render(
      <ImageLightbox
        images={[IMAGE, secondImage]}
        startIndex={0}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit photo" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Second photo" })).toBeVisible();
    expect(screen.getByLabelText("Face tag for Ada Lovelace")).not.toHaveClass(
      "opacity-0",
    );
    expect(
      screen.queryByRole("button", { name: "Next image" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Updated title" },
    });
    fireEvent.click(screen.getByRole("dialog"), { clientX: 100, clientY: 100 });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Updated title",
    );
    // Arrow keys in a text field must never navigate to a different photo.
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
      key: "ArrowLeft",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(useGalleryStore.getState().updateGalleryImage).toHaveBeenCalledWith(
      "second",
      expect.objectContaining({ title: "Updated title" }),
    );
    expect(screen.getByRole("button", { name: "Edit photo" })).toBeVisible();
    expect(screen.getByText("2 / 2")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the editor before the viewer when Escape is pressed", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    const onClose = vi.fn();
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit photo" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Edit photo" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("returns to the photo when the editor's close button is used", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    const onClose = vi.fn();
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.getByRole("heading", { name: "Portrait" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not offer editing without gallery write access", () => {
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Edit photo" }),
    ).not.toBeInTheDocument();
  });
  it("preserves metadata drafts when face operations refresh the gallery, then shows saved metadata", async () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    useGalleryStore.setState({
      updateGalleryImage: vi.fn(async (id, changes) => {
        useGalleryStore.setState((state) => ({
          galleryImages: state.galleryImages.map((image) =>
            image.id === id ? { ...image, ...changes } : image,
          ),
        }));
      }),
    });
    function LiveViewer() {
      const images = useGalleryStore((state) => state.galleryImages);
      return <ImageLightbox images={images} startIndex={0} onClose={vi.fn()} />;
    }
    render(<LiveViewer />);
    fireEvent.click(screen.getByRole("button", { name: "Edit photo" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Saved portrait" },
    });
    act(() => {
      useGalleryStore.setState({
        galleryImages: [
          {
            ...IMAGE,
            unknownFaces: [
              {
                id: "new-face",
                galleryImageId: IMAGE.id,
                x: 0.5,
                y: 0.5,
                w: 0.1,
                h: 0.1,
                taskId: "task-1",
                createdAt: "2026-01-01",
              },
            ],
          },
        ],
      });
    });
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Saved portrait",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(
      screen.getByRole("heading", { name: "Saved portrait" }),
    ).toBeVisible();
  });

  it("closes the viewer when opening a person from the editor", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    const onClose = vi.fn();
    render(<ImageLightbox images={[IMAGE]} startIndex={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(useMemberSheetStore.getState().openSheets["tree-1"]?.memberId).toBe(
      MEMBER.id,
    );
  });
  it("docks people in available space after the dialog mounts and falls back below when space runs out", () => {
    let photoRight = 940;
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.matches(".image-viewer-layout"))
          return {
            x: 80,
            left: 80,
            right: 1200,
            width: 1120,
            y: 0,
            top: 0,
            bottom: 600,
            height: 600,
            toJSON: () => ({}),
          };
        if (this.matches(".image-viewer-photo > div"))
          return {
            x: 340,
            left: 340,
            right: photoRight,
            width: photoRight - 340,
            y: 0,
            top: 0,
            bottom: 400,
            height: 400,
            toJSON: () => ({}),
          };
        return originalBounds.call(this);
      });
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
    const view = render(
      <ImageLightbox images={[IMAGE]} startIndex={0} onClose={vi.fn()} />,
    );
    try {
      const people = screen.getByRole("complementary", {
        name: "Linked people",
      });
      expect(people).toHaveClass("image-viewer-people-docked");
      expect(parseFloat(people.style.maxHeight)).toBeGreaterThan(0);
      expect(parseFloat(people.style.maxHeight)).toBeLessThan(600);
      expect(parseFloat(people.style.left) + 80).toBeGreaterThan(photoRight);
      photoRight = 1180;
      act(() =>
        callbacks.forEach((callback) => callback([], {} as ResizeObserver)),
      );
      expect(people).not.toHaveClass("image-viewer-people-docked");
      expect(people.style.left).toBe("");
    } finally {
      view.unmount();
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
