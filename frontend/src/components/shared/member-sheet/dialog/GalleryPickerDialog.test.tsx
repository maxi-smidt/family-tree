import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import type { GalleryImage } from "@/types/gallery";
import { GalleryPickerDialog } from "./GalleryPickerDialog";

const IMAGE: GalleryImage = {
  id: "image-1",
  imageData: "data:image/png;base64,abc",
  title: "Portrait",
  description: null,
  linkedMemberIds: ["member-1"],
  memberLinks: [],
  unknownFaces: [],
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

describe("GalleryPickerDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("calls onSelect with the clicked image", () => {
    const onSelect = vi.fn();
    render(
      <GalleryPickerDialog
        isOpen
        images={[IMAGE]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Portrait" }));

    expect(onSelect).toHaveBeenCalledWith(IMAGE);
  });

  it("shows an empty state when there are no images", () => {
    render(
      <GalleryPickerDialog
        isOpen
        images={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("No photos linked to this person yet."),
    ).toBeInTheDocument();
  });
});
