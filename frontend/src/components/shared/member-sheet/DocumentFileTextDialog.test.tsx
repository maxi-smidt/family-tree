import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "@/test/utils";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { DocumentFile, DocumentFileText } from "@/types/document";
import {
  DocumentFileTextButton,
  DocumentFileTextDialog,
} from "./DocumentFileTextDialog";

const FILE: DocumentFile = {
  id: "file-1",
  kind: "file",
  filename: "taufschein.pdf",
  url: "/api/media/tree-1/taufschein.pdf",
  mimeType: "application/pdf",
  size: 100,
  createdAt: "2026-01-01T00:00:00Z",
  hasText: true,
  transcriptionStatus: null,
  transcriptionError: null,
};

const TEXT: DocumentFileText = {
  fileId: "file-1",
  language: null,
  markdown: "# Taufschein\n\nJohann Schmidt",
  source: "manual",
  machineMarkdown: null,
  provider: null,
  model: null,
  editedBy: null,
  editedAt: null,
  updatedAt: "2026-01-01T00:00:00Z",
};

const loadFileText = vi.fn();
const saveFileText = vi.fn();

function renderDialog() {
  return renderWithProviders(
    <DocumentFileTextDialog
      documentId="doc-1"
      file={FILE}
      open
      onOpenChange={() => {}}
    />,
  );
}

describe("DocumentFileTextDialog", () => {
  beforeEach(() => {
    loadFileText.mockReset();
    saveFileText.mockReset();
    useDocumentStore.setState({ loadFileText, saveFileText });
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
    });
  });

  it("loads and renders the file's text", async () => {
    loadFileText.mockResolvedValue(TEXT);
    renderDialog();

    expect(await screen.findByText("Johann Schmidt")).toBeInTheDocument();
    expect(loadFileText).toHaveBeenCalledWith("doc-1", "file-1");
    expect(screen.getByText("Written by hand.")).toBeInTheDocument();
  });

  it("lets an editor correct and save the text", async () => {
    loadFileText.mockResolvedValue(TEXT);
    saveFileText.mockResolvedValue({
      ...TEXT,
      markdown: "Johann Schmidt, 1890",
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Edit text" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Johann Schmidt, 1890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveFileText).toHaveBeenCalledWith(
        "doc-1",
        "file-1",
        "Johann Schmidt, 1890",
      ),
    );
    expect(await screen.findByText("Johann Schmidt, 1890")).toBeInTheDocument();
  });

  it("shows an empty state and no edit button for viewers", async () => {
    loadFileText.mockResolvedValue(null);
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "viewer" },
    });
    renderDialog();

    expect(await screen.findByText("No text yet.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add text" }),
    ).not.toBeInTheDocument();
  });
});

describe("DocumentFileTextButton", () => {
  const viewer = { id: "tree-1", name: "Tree", role: "viewer" as const };
  const owner = { id: "tree-1", name: "Tree", role: "owner" as const };

  it("shows viewers the button only when the file has text", () => {
    useWorkspaceStore.setState({ selectedTree: viewer });
    const { rerender } = renderWithProviders(
      <DocumentFileTextButton documentId="doc-1" file={FILE} />,
    );
    expect(
      screen.getByRole("button", { name: "Show the file's text" }),
    ).toBeInTheDocument();

    rerender(
      <DocumentFileTextButton
        documentId="doc-1"
        file={{ ...FILE, hasText: false }}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers editors an add button for files without text", () => {
    useWorkspaceStore.setState({ selectedTree: owner });
    renderWithProviders(
      <DocumentFileTextButton
        documentId="doc-1"
        file={{ ...FILE, hasText: false }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add the file's text" }),
    ).toBeInTheDocument();
  });
});
