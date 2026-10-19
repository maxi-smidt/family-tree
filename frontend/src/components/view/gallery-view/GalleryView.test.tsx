import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { GalleryImage } from "@/types/gallery";
import { GalleryView } from "./GalleryView";

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
    useWorkspaceStore.setState({
      isReady: true,
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    useGalleryStore.setState({ galleryImages, initialized: true });
  });

  it("renders only matching images", () => {
    render(<GalleryView />);

    fireEvent.change(screen.getByPlaceholderText("Search photos…"), {
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

describe("GalleryView image modes", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      isReady: true,
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    useMemberStore.setState({ members: [] });
    useGalleryStore.setState({
      galleryImages: galleryImages.map((image) => ({
        ...image,
        description: "Photo description",
        unknownFaces: [
          {
            id: "face-1",
            galleryImageId: image.id,
            x: 0.2,
            y: 0.3,
            w: 0.2,
            h: 0.2,
            taskId: "task-1",
            createdAt: "2024-01-01",
          },
        ],
      })),
      initialized: true,
    });
  });

  it("opens the shared viewer at the clicked image and navigates the gallery order", () => {
    render(<GalleryView />);
    fireEvent.click(screen.getByRole("button", { name: "Matching photo" }));
    const viewer = screen.getByRole("dialog");
    expect(
      within(viewer).getByRole("heading", { name: "Matching photo" }),
    ).toBeVisible();
    expect(within(viewer).getByText("Photo description")).toBeVisible();
    expect(within(viewer).getByLabelText("Unknown person")).toHaveClass(
      "opacity-0",
    );
    expect(
      screen.queryByPlaceholderText("Enter title"),
    ).not.toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole("button", { name: "Next image" }));
    expect(
      within(viewer).getByRole("heading", { name: "Other photo" }),
    ).toBeVisible();
  });

  it("opens editing directly from the pencil with all face outlines visible", () => {
    render(<GalleryView />);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Matching photo" }),
    );
    const editor = screen.getByRole("dialog");
    expect(within(editor).getByRole("button", { name: "Save" })).toBeVisible();
    expect(within(editor).getByLabelText("Unknown person")).not.toHaveClass(
      "opacity-0",
    );
    expect(
      screen.queryByRole("button", { name: "Next image" }),
    ).not.toBeInTheDocument();
  });

  it("keeps navigation within the gallery filter", () => {
    render(<GalleryView />);
    fireEvent.change(screen.getByPlaceholderText("Search photos…"), {
      target: { value: "matching" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Matching photo" }));
    expect(
      screen.queryByRole("button", { name: "Next image" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeVisible();
  });

  it("offers viewing without an edit pencil to read-only users", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Workspace", role: "viewer" },
    });
    render(<GalleryView />);
    expect(
      screen.queryByRole("button", { name: /^Edit / }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Matching photo" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

describe("GalleryView loading", () => {
  const images = Array.from({ length: 145 }, (_, index) => ({
    ...galleryImages[0],
    id: `image-${index}`,
    imageData: "data:image/png;base64,abc",
    title: `Photo ${index.toString().padStart(3, "0")}`,
    uploadedAt: new Date(2024, 0, index + 1).toISOString(),
  }));

  beforeEach(() => {
    useWorkspaceStore.setState({
      isReady: true,
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    useGalleryStore.setState({ galleryImages: images, initialized: true });
  });

  it("renders a larger first batch and can reach every photo without an observer", () => {
    render(<GalleryView />);
    expect(screen.getAllByRole("button", { name: /^Photo / })).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(screen.getAllByRole("button", { name: /^Photo / })).toHaveLength(
      120,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all photos" }));
    expect(screen.getAllByRole("button", { name: /^Photo / })).toHaveLength(
      145,
    );
    expect(
      screen.getByRole("button", { name: "Photo 000" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing 145 of 145 photos",
    );
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("loads another batch when the grid footer approaches the scroll viewport", () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    try {
      const { unmount } = render(<GalleryView />);
      act(() =>
        callbacks[0](
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
      expect(screen.getAllByRole("button", { name: /^Photo / })).toHaveLength(
        120,
      );
      expect(disconnect).toHaveBeenCalled();
      act(() =>
        callbacks[callbacks.length - 1](
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
      expect(screen.getAllByRole("button", { name: /^Photo / })).toHaveLength(
        145,
      );
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("searches the entire gallery and resets batches after clearing a search or changing order", () => {
    render(<GalleryView />);
    const search = screen.getByPlaceholderText("Search photos…");
    fireEvent.change(search, { target: { value: "Photo 000" } });
    expect(
      screen.getByRole("button", { name: "Photo 000" }),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getAllByRole("button", { name: /^Photo / })).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "Show all photos" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort descending" }));
    expect(screen.getAllByRole("button", { name: /^Photo / })).toHaveLength(60);
    expect(
      screen.getByRole("button", { name: "Photo 000" }),
    ).toBeInTheDocument();
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
    useWorkspaceStore.setState({
      isReady: true,
      selectedTree: { id: "tree-1", name: "Workspace", role: "owner" },
    });
    useGalleryStore.setState({
      galleryImages: imagesWithMissingDate,
      initialized: true,
    });
  });

  it("sorts a null-dated image to a consistent end instead of crashing/NaN-ordering", () => {
    render(<GalleryView />);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Date Taken" }));

    const cards = screen.getAllByRole("button", {
      name: /^(Dated|Undated) photo$/,
    });
    // Default sort direction is descending (newest first); comparePartialDates
    // treats a missing date as "earliest", so the undated photo sorts last
    // instead of producing a NaN-driven, undefined order.
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Dated photo"),
      expect.stringContaining("Undated photo"),
    ]);
  });
});
