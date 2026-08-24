import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { MediaView } from "./MediaView";

vi.mock("@/components/view/gallery-view/GalleryView", () => ({
  GalleryView: () => <div>Gallery content</div>,
}));
vi.mock("@/components/view/documents-view/DocumentsView", () => ({
  DocumentsView: () => <div>Documents content</div>,
}));

describe("MediaView", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", role: "owner", restrictions: [] } as never,
    });
  });

  it("renders the Gallery section selected from the Media menu", () => {
    render(<MediaView section="gallery" />);

    expect(screen.getByText("Gallery content")).toBeInTheDocument();
  });

  it("falls back to Documents when Gallery is unavailable", () => {
    useWorkspaceStore.setState({
      selectedTree: {
        id: "tree-1",
        role: "owner",
        restrictions: ["gallery"],
      } as never,
    });

    render(<MediaView section="gallery" />);

    expect(screen.getByText("Documents content")).toBeInTheDocument();
  });

  it("falls back to Gallery when Documents is unavailable", () => {
    useWorkspaceStore.setState({
      selectedTree: {
        id: "tree-1",
        role: "owner",
        restrictions: ["sources"],
      } as never,
    });

    render(<MediaView section="documents" />);

    expect(screen.getByText("Gallery content")).toBeInTheDocument();
  });
});
