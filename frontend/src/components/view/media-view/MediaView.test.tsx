import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
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
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useTreeStore.setState({
      selectedTree: { id: "tree-1", role: "owner", restrictions: [] } as never,
    });
  });

  it("groups Gallery and Documents under nested Media options", async () => {
    useAuthStore.setState({ features: ["gallery", "sources"] });

    render(<MediaView />);

    expect(screen.getByRole("tab", { name: "Gallery" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByText("Gallery content")).toBeInTheDocument();

    const documentsTab = screen.getByRole("tab", { name: "Documents" });
    fireEvent.mouseDown(documentsTab, { button: 0 });
    fireEvent.click(documentsTab);
    await waitFor(() => {
      expect(screen.getByText("Documents content")).toBeInTheDocument();
    });
  });

  it("only shows the accessible media option", () => {
    useAuthStore.setState({ features: ["sources"] });

    render(<MediaView />);

    expect(
      screen.queryByRole("tab", { name: "Gallery" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByText("Documents content")).toBeInTheDocument();
  });
});
