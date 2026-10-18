import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "@/test/utils";
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
  aiVersionWaiting: false,
  editedBy: null,
  editedAt: null,
  updatedAt: "2026-01-01T00:00:00Z",
};

const loadFileText = vi.fn();
const saveFileText = vi.fn();

// PDF canvas rendering is exercised in Playwright; keep the page coordination
// and the real editor/save flow here without a browser canvas implementation.
vi.mock("./DocumentFilePreview", () => ({
  DocumentFilePreview: ({
    page,
    onPageCount,
  }: {
    page: number;
    onPageCount: (count: number) => void;
  }) => {
    useEffect(() => onPageCount(3), [onPageCount]);
    return <div role="img" aria-label={`Original page ${page}`} />;
  },
}));

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

    // The real Markdown pipeline loads lazily on the first read.
    expect(
      await screen.findByText("Johann Schmidt", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(loadFileText).toHaveBeenCalledWith("doc-1", "file-1");
    expect(screen.getByText("Written by hand.")).toBeInTheDocument();
  });

  it("offers a waiting AI version next to an edited text", async () => {
    loadFileText.mockResolvedValue({
      ...TEXT,
      machineMarkdown: "Neue Fassung",
      aiVersionWaiting: true,
    });
    saveFileText.mockResolvedValue({ ...TEXT, markdown: "Neue Fassung" });
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Use AI version" }),
    );
    await waitFor(() =>
      expect(saveFileText).toHaveBeenCalledWith(
        "doc-1",
        "file-1",
        "Neue Fassung",
      ),
    );
  });

  it("shows no AI notice for an edited text without a new run", async () => {
    loadFileText.mockResolvedValue({ ...TEXT, machineMarkdown: "Alt" });
    renderDialog();
    expect(await screen.findByText("Johann Schmidt")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use AI version" }),
    ).not.toBeInTheDocument();
  });

  it("restores the stored AI version after confirmation", async () => {
    loadFileText.mockResolvedValue({ ...TEXT, machineMarkdown: "KI-Text" });
    saveFileText.mockResolvedValue({
      ...TEXT,
      markdown: "KI-Text",
      source: "ai",
      machineMarkdown: "KI-Text",
    });
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Restore AI version" }),
    );
    expect(saveFileText).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Restore AI version" }),
    );

    await waitFor(() =>
      expect(saveFileText).toHaveBeenCalledWith("doc-1", "file-1", "KI-Text"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Restore AI version" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("offers no restore when the text is the AI version", async () => {
    loadFileText.mockResolvedValue({
      ...TEXT,
      source: "ai",
      machineMarkdown: TEXT.markdown,
    });
    renderDialog();
    expect(await screen.findByText("Johann Schmidt")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore AI version" }),
    ).not.toBeInTheDocument();
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

  it("keeps the original page and rendered Markdown together while navigating", async () => {
    loadFileText.mockResolvedValue({
      ...TEXT,
      markdown: "<!-- page 1 -->\nFirst page\n<!-- page 2 -->\nSecond page",
    });
    renderDialog();
    expect(await screen.findByText("First page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Second page")).toBeInTheDocument();
    expect(screen.queryByText("First page")).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Original page 2" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("No text for this page yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("saves corrections on several pages as one Markdown text with its markers intact", async () => {
    const original = "<!-- page 1 -->\nFirst\n<!-- page 3 -->\nThird";
    loadFileText.mockResolvedValue({ ...TEXT, markdown: original });
    saveFileText.mockImplementation(
      async (_doc: string, _file: string, markdown: string) => ({
        ...TEXT,
        markdown,
      }),
    );
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Edit text" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Corrected first\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Second" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("textbox")).toHaveValue("\nThird");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveFileText).toHaveBeenCalledWith(
        "doc-1",
        "file-1",
        expect.stringMatching(
          /<!-- page 1 -->Corrected first\n[\s\S]*<!-- page 2 -->\nSecond[\s\S]*<!-- page 3 -->\nThird/,
        ),
      ),
    );
  });

  it("opens the matching page for a search hit and keeps viewers read-only", async () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "viewer" },
    });
    loadFileText.mockResolvedValue({
      ...TEXT,
      markdown: "<!-- page 1 -->\nFirst\n<!-- page 2 -->\nJohann Schmidt",
    });
    renderWithProviders(
      <DocumentFileTextDialog
        documentId="doc-1"
        file={FILE}
        open
        onOpenChange={() => {}}
        highlight={["schmidt"]}
      />,
    );
    expect(await screen.findByText("Johann Schmidt")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Page" })).toHaveValue(2);
    expect(
      screen.queryByRole("button", { name: "Edit text" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore AI version" }),
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
