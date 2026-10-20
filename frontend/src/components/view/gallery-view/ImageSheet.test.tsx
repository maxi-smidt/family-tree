import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
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
    useMemberSheetStore.setState({ openSheets: {} });
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    useGalleryStore.setState({
      galleryImages: [],
      updateGalleryImage: vi.fn().mockResolvedValue(undefined),
      addUnknownFace: vi.fn().mockResolvedValue(undefined),
      resolveUnknownFace: vi.fn().mockResolvedValue(undefined),
      removeUnknownFace: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("always shows face outlines and plain-text names, including while tagging", () => {
    render(
      <ImageSheet
        isOpen
        onClose={vi.fn()}
        image={{
          ...IMAGE,
          memberLinks: [
            { memberId: MEMBER.id, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
          ],
        }}
      />,
    );
    const face = screen.getByLabelText("Face tag for Ada Lovelace");
    expect(face).toHaveTextContent("Ada Lovelace");
    expect(face).not.toHaveTextContent("1815");
    expect(face.querySelector("img")).toBeNull();
    expect(face.querySelector(".rounded-full")).toBeNull();
    expect(face).not.toHaveClass("opacity-0");
    fireEvent.mouseEnter(face);
    expect(face).not.toHaveClass("opacity-0");
    fireEvent.mouseLeave(face);
    expect(face).not.toHaveClass("opacity-0");
    fireEvent.focus(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(face).not.toHaveClass("opacity-0");
    fireEvent.blur(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(face).not.toHaveClass("opacity-0");
    fireEvent.click(screen.getByRole("button", { name: "Tag faces" }));
    expect(face).not.toHaveClass("opacity-0");
  });

  it.each([false, true])(
    "shows every known and unknown face name without hover (inline: %s)",
    (inline) => {
      render(
        <ImageSheet
          isOpen
          inline={inline}
          onClose={vi.fn()}
          image={{
            ...IMAGE_WITH_UNKNOWN_FACE,
            memberLinks: [
              { memberId: MEMBER.id, x: 0.1, y: 0.2, w: 0.2, h: 0.2 },
              { memberId: UNLINKED_MEMBER.id, x: 0.6, y: 0.2, w: 0.2, h: 0.2 },
            ],
          }}
        />,
      );
      for (const [label, name] of [
        ["Face tag for Ada Lovelace", "Ada Lovelace"],
        ["Face tag for Alan Turing", "Alan Turing"],
        ["Unknown person", "Unknown person"],
      ]) {
        const face = screen.getByLabelText(label);
        expect(face).toBeVisible();
        expect(face).not.toHaveClass("opacity-0");
        expect(face).toHaveTextContent(name);
        expect(face.querySelector(".rounded-full")).toBeNull();
      }
    },
  );

  it("shows linked people with the same avatar, name and lifespan chip used for relatives", () => {
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);
    const chip = screen.getByRole("button", { name: "Open Ada Lovelace" });
    expect(chip).toHaveTextContent("AL");
    expect(chip).toHaveTextContent("Ada Lovelace");
    expect(chip).toHaveTextContent("1815");
    expect(
      screen.getByRole("region", { name: "Linked Members 1" }),
    ).toContainElement(chip);
  });

  it.each([
    {
      label: "a whole-image link",
      action: "Add face tag for Ada Lovelace",
      region: { x: null, y: null, w: null, h: null },
    },
    {
      label: "an existing face tag",
      action: "Edit face tag for Ada Lovelace",
      region: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
    },
  ])(
    "lets the row pencil draw a face region for $label without reselecting the person",
    async ({ action, region }) => {
      render(
        <ImageSheet
          isOpen
          onClose={vi.fn()}
          image={{
            ...IMAGE,
            memberLinks: [{ memberId: MEMBER.id, ...region }],
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: action }));
      const overlay = document.querySelector(".cursor-crosshair") as Element;
      fireEvent.pointerDown(overlay, { clientX: 10, clientY: 20, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 50, clientY: 60 });
      fireEvent.pointerUp(overlay, { clientX: 50, clientY: 60 });
      expect(
        screen.getByLabelText("Face tag for Ada Lovelace"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(
        useGalleryStore.getState().updateGalleryImage,
      ).toHaveBeenCalledWith(
        IMAGE.id,
        expect.objectContaining({
          memberLinks: [
            {
              memberId: MEMBER.id,
              x: 0.1,
              y: 0.2,
              w: expect.closeTo(0.4),
              h: expect.closeTo(0.4),
            },
          ],
        }),
      );
    },
  );

  it("lets the row pencil reassign a whole-image link to another person", async () => {
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add face tag for Ada Lovelace" }),
    );
    fireEvent.click(screen.getByRole("combobox"));
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("option", { name: /Alan Turing/ }),
      );
    });
    expect(
      screen.getByRole("button", { name: "Open Alan Turing" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Ada Lovelace" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(useGalleryStore.getState().updateGalleryImage).toHaveBeenCalledWith(
      IMAGE.id,
      expect.objectContaining({
        memberLinks: [
          { memberId: UNLINKED_MEMBER.id, x: null, y: null, w: null, h: null },
        ],
      }),
    );
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

  it("offers 'Mark as unknown person' when research tasks are unrestricted", () => {
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);

    fireEvent.click(screen.getByRole("button", { name: "Tag faces" }));
    const overlay = document.querySelector(".cursor-crosshair") as Element;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(overlay, { clientX: 40, clientY: 40 });

    expect(
      screen.getByRole("button", { name: "Mark as unknown person" }),
    ).toBeInTheDocument();
  });

  it("persists a new unknown-face tag immediately when marked", async () => {
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
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("option", { name: /Alan Turing/ }),
      );
    });

    const { resolveUnknownFace } = useGalleryStore.getState();
    await vi.waitFor(() => {
      expect(resolveUnknownFace).toHaveBeenCalledWith(
        "face-1",
        UNLINKED_MEMBER.id,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(
        useGalleryStore.getState().updateGalleryImage,
      ).toHaveBeenCalledWith(
        IMAGE.id,
        expect.objectContaining({
          memberLinks: expect.arrayContaining([
            expect.objectContaining({
              memberId: UNLINKED_MEMBER.id,
              x: 0.4,
              y: 0.4,
              w: 0.2,
              h: 0.2,
            }),
          ]),
        }),
      );
    });
  });

  it("opens linked profiles for readers as well as editors", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "viewer" },
    });
    const onClose = vi.fn();
    render(<ImageSheet isOpen onClose={onClose} image={IMAGE} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(onClose).toHaveBeenCalled();
    expect(useMemberSheetStore.getState().openSheets["tree-1"]).toEqual({
      memberId: MEMBER.id,
      tab: "identity",
      mode: "view",
    });
    expect(
      useGalleryStore.getState().updateGalleryImage,
    ).not.toHaveBeenCalled();
  });

  it("can identify an unknown face as someone already linked to the whole photo", async () => {
    render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE_WITH_UNKNOWN_FACE} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Identify this person" }),
    );
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("option", { name: /Ada Lovelace/ }),
      );
    });
    expect(useGalleryStore.getState().resolveUnknownFace).toHaveBeenCalledWith(
      "face-1",
      MEMBER.id,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(useGalleryStore.getState().updateGalleryImage).toHaveBeenCalledWith(
      IMAGE.id,
      expect.objectContaining({
        memberLinks: [{ memberId: MEMBER.id, x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
      }),
    );
  });

  it("preserves the drawn region if marking an unknown person fails", async () => {
    useGalleryStore.setState({
      addUnknownFace: vi.fn().mockRejectedValue(new Error("Offline")),
    });
    render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE} initialTagMode />,
    );
    const overlay = document.querySelector(".cursor-crosshair") as Element;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(overlay, { clientX: 40, clientY: 40 });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Mark as unknown person" }),
      );
    });
    expect(
      screen.getByRole("button", { name: "Mark as unknown person" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Cancel tag edit" }),
    ).toBeInTheDocument();
    expect(useGalleryStore.getState().addUnknownFace).toHaveBeenCalledWith(
      IMAGE.id,
      expect.objectContaining({
        x: 0.1,
        y: 0.1,
        w: expect.closeTo(0.3),
        h: expect.closeTo(0.3),
      }),
      expect.anything(),
    );
  });

  it("links a person on selection and saves edits before opening their profile", async () => {
    const onClose = vi.fn();
    render(<ImageSheet isOpen onClose={onClose} image={IMAGE} />);
    fireEvent.click(screen.getByRole("combobox"));
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("option", { name: /Alan Turing/ }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Alan Turing" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useGalleryStore.getState().updateGalleryImage).toHaveBeenCalledWith(
      IMAGE.id,
      expect.objectContaining({
        linkedMemberIds: [MEMBER.id, UNLINKED_MEMBER.id],
      }),
    );
    expect(useMemberSheetStore.getState().openSheets["tree-1"].memberId).toBe(
      UNLINKED_MEMBER.id,
    );
  });

  it("stays on the photo if saving before opening a person fails", async () => {
    useGalleryStore.setState({
      updateGalleryImage: vi.fn().mockRejectedValue(new Error("Save failed")),
    });
    const onClose = vi.fn();
    render(<ImageSheet isOpen onClose={onClose} image={IMAGE} />);
    fireEvent.change(screen.getByPlaceholderText("Image Title"), {
      target: { value: "Edited title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    await vi.waitFor(() =>
      expect(useGalleryStore.getState().updateGalleryImage).toHaveBeenCalled(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(useMemberSheetStore.getState().openSheets).toEqual({});
  });

  it("opens search after drawing, assigns on selection, and stays ready for another face", async () => {
    render(
      <ImageSheet isOpen onClose={vi.fn()} image={IMAGE} initialTagMode />,
    );
    const overlay = document.querySelector(".cursor-crosshair") as Element;
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 40, clientY: 40 });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.pointerUp(overlay, { clientX: 40, clientY: 40 });
    fireEvent.click(
      await screen.findByRole("option", { name: /Ada Lovelace/ }),
    );
    expect(
      screen.getByLabelText("Face tag for Ada Lovelace"),
    ).toBeInTheDocument();
    expect(document.querySelector(".cursor-crosshair")).toBeInTheDocument();
    fireEvent.pointerDown(overlay, { clientX: 60, clientY: 60, button: 0 });
    fireEvent.pointerUp(overlay, { clientX: 90, clientY: 90 });
    expect(
      screen.queryByRole("option", { name: /Ada Lovelace/ }),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("option", { name: /Alan Turing/ }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(useGalleryStore.getState().updateGalleryImage).toHaveBeenCalledWith(
      IMAGE.id,
      expect.objectContaining({
        memberLinks: [
          {
            memberId: MEMBER.id,
            x: 0.1,
            y: 0.1,
            w: expect.closeTo(0.3),
            h: expect.closeTo(0.3),
          },
          {
            memberId: UNLINKED_MEMBER.id,
            x: 0.6,
            y: 0.6,
            w: expect.closeTo(0.3),
            h: expect.closeTo(0.3),
          },
        ],
      }),
    );
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
