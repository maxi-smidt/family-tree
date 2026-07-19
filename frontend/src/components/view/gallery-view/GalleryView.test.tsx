import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import type { GalleryImage } from "@/types/gallery";
import { GalleryView } from "./GalleryView";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index })),
  }),
}));

const galleryImages: GalleryImage[] = [
  {
    id: "matching-image",
    imageData: "/api/media/matching.jpg",
    title: "Matching photo",
    description: null,
    linkedMemberIds: [],
    memberLinks: [],
    unknownFaces: [],
    createdAt: "2024-01-01T00:00:00Z",
    uploadedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "other-image",
    imageData: "/api/media/other.jpg",
    title: "Other photo",
    description: null,
    linkedMemberIds: [],
    memberLinks: [],
    unknownFaces: [],
    createdAt: "2024-02-01T00:00:00Z",
    uploadedAt: "2024-02-01T00:00:00Z",
  },
];

describe("GalleryView search", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useTreeStore.setState({ isReady: true });
    useGalleryStore.setState({ galleryImages, initialized: true });
  });

  it("renders only matching images without requesting an out-of-range virtual item", () => {
    render(<GalleryView />);

    fireEvent.change(screen.getByPlaceholderText("Search image..."), {
      target: { value: "matching" },
    });

    expect(
      screen.getByRole("button", { name: "Matching photo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Other photo" }),
    ).not.toBeInTheDocument();
  });
});
