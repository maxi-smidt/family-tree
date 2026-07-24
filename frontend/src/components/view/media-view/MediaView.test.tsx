import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { MediaView } from "./MediaView";

vi.mock("@/components/view/gallery-view/GalleryView", () => ({
  GalleryView: () => <div>Gallery content</div>,
}));
vi.mock("@/components/view/documents-view/DocumentsView", () => ({
  DocumentsView: () => <div>Documents content</div>,
}));

describe("MediaView", () => {
  beforeEach(() => {
    useTreeStore.setState({
      selectedTree: { id: "tree-1", role: "owner", restrictions: [] } as never,
    });
  });

  it("renders the Gallery section selected from the Media menu", () => {
    useAuthStore.setState({ features: ["gallery", "sources"] });

    render(<MediaView section="gallery" />);

    expect(screen.getByText("Gallery content")).toBeInTheDocument();
  });

  it("falls back to Documents when Gallery is unavailable", () => {
    useAuthStore.setState({ features: ["sources"] });

    render(<MediaView section="gallery" />);

    expect(screen.getByText("Documents content")).toBeInTheDocument();
  });

  it("falls back to Gallery when Documents is unavailable", () => {
    useAuthStore.setState({ features: ["gallery"] });

    render(<MediaView section="documents" />);

    expect(screen.getByText("Gallery content")).toBeInTheDocument();
  });
});
