import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "@/test/utils";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { openMedia } from "@/hooks/useMediaUrl";
import type { DocumentFile } from "@/types/document";
import { DocumentFileList } from "./DocumentFiles";

vi.mock("@/hooks/useMediaUrl", () => ({
  openMedia: vi.fn().mockResolvedValue(undefined),
  downloadMedia: vi.fn().mockResolvedValue(undefined),
  useMediaUrl: () => undefined,
}));
vi.mock("./DocumentFilePreview", () => ({
  DocumentFilePreview: () => <div>Original preview</div>,
}));

const file: DocumentFile = {
  id: "file-1",
  kind: "file",
  filename: "register.pdf",
  url: "/api/media/tree-1/register.pdf",
  mimeType: "application/pdf",
  size: 100,
  createdAt: "2026-01-01T00:00:00Z",
  hasText: false,
  transcriptionStatus: null,
  transcriptionError: null,
};

describe("DocumentFileList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({
      loadFileText: vi.fn().mockResolvedValue(null),
    });
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "viewer" },
    });
  });

  it("opens a member-profile file in the reader even without transcription text", async () => {
    renderWithProviders(<DocumentFileList documentId="doc-1" files={[file]} />);
    fireEvent.click(screen.getByRole("button", { name: "register.pdf" }));
    expect(await screen.findByText("No text yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Text of register.pdf" }),
    ).toBeInTheDocument();
    expect(openMedia).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Add text" }),
    ).not.toBeInTheDocument();
  });

  it("opens the external-window icon without opening the reader or toggling the parent", () => {
    const parentClick = vi.fn();
    renderWithProviders(
      <div onClick={parentClick}>
        <DocumentFileList documentId="doc-1" files={[file]} />
      </div>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open in another window" }),
    );
    expect(openMedia).toHaveBeenCalledWith(file.url);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("keeps external document links as links to another window", () => {
    renderWithProviders(
      <DocumentFileList
        documentId="doc-1"
        files={[
          {
            ...file,
            kind: "link",
            filename: "Archive record",
            url: "https://example.com/record",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Archive record" });
    expect(link).toHaveAttribute("href", "https://example.com/record");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
