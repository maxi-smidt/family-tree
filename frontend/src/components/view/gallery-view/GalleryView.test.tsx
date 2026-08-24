import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
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
    createdAt: "2024-01-01",
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
    createdAt: "2024-02-01",
    uploadedAt: "2024-02-01T00:00:00Z",
  },
];

describe("GalleryView search", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ isReady: true });
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

describe("GalleryView sort by date taken", () => {
  const imagesWithMissingDate: GalleryImage[] = [
    {
      id: "dated-image",
      imageData: "/api/media/dated.jpg",
      title: "Dated photo",
      description: null,
      linkedMemberIds: [],
      memberLinks: [],
      unknownFaces: [],
      createdAt: "1950",
      uploadedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "undated-image",
      imageData: "/api/media/undated.jpg",
      title: "Undated photo",
      description: null,
      linkedMemberIds: [],
      memberLinks: [],
      unknownFaces: [],
      createdAt: null,
      uploadedAt: "2024-02-01T00:00:00Z",
    },
  ];

  beforeEach(() => {
    useWorkspaceStore.setState({ isReady: true });
    useGalleryStore.setState({
      galleryImages: imagesWithMissingDate,
      initialized: true,
    });
  });

  it("sorts a null-dated image to a consistent end instead of crashing/NaN-ordering", () => {
    render(<GalleryView />);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Date Taken" }));

    const cards = screen.getAllByRole("button", { name: /photo$/ });
    // Default sort direction is descending (newest first); comparePartialDates
    // treats a missing date as "earliest", so the undated photo sorts last
    // instead of producing a NaN-driven, undefined order.
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Dated photo"),
      expect.stringContaining("Undated photo"),
    ]);
  });
});
