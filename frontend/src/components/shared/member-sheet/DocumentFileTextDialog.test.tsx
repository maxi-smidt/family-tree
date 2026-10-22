import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "@/test/utils";
import { useAiSettingsStore } from "@/hooks/useAiSettingsStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useCitationStore } from "@/hooks/useCitationStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { Member } from "@/types/member";
import { downloadMedia } from "@/hooks/useMediaUrl";
import type { DocumentFile, DocumentFileText } from "@/types/document";
import {
  DocumentFileReaderTrigger,
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

vi.mock("@/hooks/useMediaUrl", () => ({
  openMedia: vi.fn().mockResolvedValue(undefined),
  downloadMedia: vi.fn().mockResolvedValue(undefined),
}));

// PDF canvas rendering is exercised in Playwright; keep the page coordination
// and the real editor/save flow here without a browser canvas implementation.
vi.mock("./DocumentFilePreview", () => ({
  DocumentFilePreview: ({
    page,
    onPageCount,
    navigation,
  }: {
    page: number;
    onPageCount: (count: number) => void;
    navigation?: ReactNode;
  }) => {
    useEffect(() => onPageCount(3), [onPageCount]);
    return (
      <>
        <div role="img" aria-label={`Original page ${page}`} />
        {navigation}
      </>
    );
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

function enableAi() {
  useAiSettingsStore.setState({
    settings: {
      configured: true,
      provider: "gemini",
      model: "gemini-test",
      base_url: null,
      has_api_key: true,
      api_key_hint: "test",
      api_key_unreadable: false,
      providers: [
        {
          id: "gemini",
          label: "Google Gemini",
          default_model: "gemini-test",
          needs_api_key: true,
          custom_base_url: false,
          supports_pdf: true,
        },
      ],
    },
  });
}

describe("DocumentFileTextDialog", () => {
  beforeEach(() => {
    loadFileText.mockReset();
    saveFileText.mockReset();
    useDocumentStore.setState({ loadFileText, saveFileText });
    useAiSettingsStore.setState({
      settings: null,
      load: vi.fn().mockResolvedValue(undefined),
    });
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
    });
    useCitationStore.setState({ citations: [], initialized: true });
  });

  it("loads and renders the file's text", async () => {
    loadFileText.mockResolvedValue(TEXT);
    renderDialog();

    // The real Markdown pipeline loads lazily on the first read.
    expect(
      await screen.findByText("Johann Schmidt", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(loadFileText).toHaveBeenCalledWith("doc-1", "file-1");
    expect(screen.queryByText("Written by hand.")).not.toBeInTheDocument();
  });

  it("promotes transcription to the header only when text is missing", async () => {
    enableAi();
    loadFileText.mockResolvedValue(null);
    renderDialog();
    await screen.findByText("No text yet.");
    const header = document.querySelector(
      '[data-slot="document-reader-header"]',
    )! as HTMLElement;
    expect(
      within(header).getByRole("button", { name: "Transcribe with AI" }),
    ).toBeVisible();
    fireEvent.click(
      within(header).getByRole("button", { name: "Transcribe with AI" }),
    );
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Send this file to Google Gemini?",
    );
  });

  it("opens the transcription confirmation from the menu after it closes", async () => {
    enableAi();
    const transcribeFile = vi.fn().mockResolvedValue(undefined);
    useDocumentStore.setState({ transcribeFile });
    loadFileText.mockResolvedValue(TEXT);
    renderDialog();
    await screen.findByText("Johann Schmidt");
    expect(
      screen.queryByRole("button", { name: "Transcribe again" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "File options" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Transcribe again" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(transcribeFile).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Send to Google Gemini" }),
    );
    await waitFor(() =>
      expect(transcribeFile).toHaveBeenCalledWith("doc-1", "file-1"),
    );
  });

  it("promotes restore ahead of transcription when an AI version is available", async () => {
    enableAi();
    loadFileText.mockResolvedValue({
      ...TEXT,
      markdown: "",
      machineMarkdown: "Saved AI text",
    });
    renderDialog();
    expect(
      await screen.findByRole("button", { name: "Restore AI version" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Transcribe with AI" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "File options" }), {
      key: "Enter",
    });
    expect(
      await screen.findByRole("menuitem", { name: "Restore AI version" }),
    ).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Open file" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Download" })).toBeVisible();
  });

  it("switches between document, text and both without losing the split ratio", async () => {
    loadFileText.mockResolvedValue(TEXT);
    renderDialog();
    await screen.findByText("Johann Schmidt");
    const views = screen.getByRole("radiogroup", { name: "Viewer layout" });
    const document = screen.getByRole("region", { name: "Original file" });
    const text = screen.getByRole("region", { name: "Document text" });
    const divider = screen.getByRole("separator");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "55");
    fireEvent.click(within(views).getByRole("radio", { name: "Document" }));
    expect(document).toBeVisible();
    expect(text).not.toBeVisible();
    expect(divider).not.toBeVisible();
    fireEvent.click(within(views).getByRole("radio", { name: "Text" }));
    expect(document).not.toBeVisible();
    expect(text).toBeVisible();
    fireEvent.click(within(views).getByRole("radio", { name: "Both" }));
    expect(document).toBeVisible();
    expect(text).toBeVisible();
    expect(divider).toHaveAttribute("aria-valuenow", "55");
    // Clicking the selected option must not leave the reader without a view.
    fireEvent.click(within(views).getByRole("radio", { name: "Both" }));
    expect(document).toBeVisible();
    expect(text).toBeVisible();
  });

  it("keeps hidden document and text pages synchronized", async () => {
    loadFileText.mockResolvedValue({
      ...TEXT,
      markdown: "<!-- page 1 -->\nFirst page\n<!-- page 2 -->\nSecond page",
    });
    renderDialog();
    await screen.findByText("First page");
    const views = screen.getByRole("radiogroup", { name: "Viewer layout" });
    fireEvent.click(within(views).getByRole("radio", { name: "Document" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("img", { name: "Original page 2" })).toBeVisible();
    fireEvent.click(within(views).getByRole("radio", { name: "Text" }));
    expect(await screen.findByText("Second page")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(within(views).getByRole("radio", { name: "Document" }));
    expect(screen.getByRole("img", { name: "Original page 1" })).toBeVisible();
    expect(loadFileText).toHaveBeenCalledTimes(1);
  });

  it("reveals the editor from document-only view and preserves drafts across views", async () => {
    loadFileText.mockResolvedValue(TEXT);
    renderDialog();
    await screen.findByText("Johann Schmidt");
    const views = screen.getByRole("radiogroup", { name: "Viewer layout" });
    const documentOnly = within(views).getByRole("radio", {
      name: "Document",
    });
    fireEvent.click(documentOnly);
    fireEvent.keyDown(screen.getByRole("button", { name: "File options" }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit text" }));
    const editor = screen.getByRole("textbox");
    expect(editor).toBeVisible();
    fireEvent.change(editor, { target: { value: "Corrected text" } });
    fireEvent.click(documentOnly);
    expect(editor).not.toBeVisible();
    fireEvent.click(within(views).getByRole("radio", { name: "Text" }));
    expect(editor).toBeVisible();
    expect(editor).toHaveValue("Corrected text");
    expect(saveFileText).not.toHaveBeenCalled();
  });

  it("clears the running banner and reloads an open preview on completion", async () => {
    useDocumentStore.setState({
      documents: [
        {
          id: "doc-1",
          title: "Certificate",
          description: null,
          documentDate: null,
          createdAt: FILE.createdAt,
          updatedAt: FILE.createdAt,
          files: [{ ...FILE, transcriptionStatus: "pending" }],
          memberIds: [],
          eventIds: [],
          storyIds: [],
        },
      ],
    });
    loadFileText.mockResolvedValueOnce(TEXT).mockResolvedValueOnce({
      ...TEXT,
      source: "ai",
      markdown: "Completed AI transcript",
    });
    function Reader() {
      const file = useDocumentStore((s) => s.documents[0].files[0]);
      return (
        <DocumentFileTextDialog
          documentId="doc-1"
          file={file}
          open
          onOpenChange={() => {}}
        />
      );
    }
    renderWithProviders(<Reader />);
    expect(await screen.findByText("Johann Schmidt")).toBeInTheDocument();
    expect(screen.getByText(/AI transcription is running/)).toBeInTheDocument();

    act(() => {
      useDocumentStore
        .getState()
        .onTranscriptionFinished("tree-1", "doc-1", FILE.id, "done", null);
    });

    expect(
      await screen.findByText("Completed AI transcript"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/AI transcription is running/)).toBeNull();
    expect(loadFileText).toHaveBeenCalledTimes(2);
  });

  it("downloads the original file from the reader", async () => {
    loadFileText.mockResolvedValue(TEXT);
    renderDialog();
    await screen.findByText("Johann Schmidt");
    fireEvent.keyDown(screen.getByRole("button", { name: "File options" }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download" }));
    await waitFor(() =>
      expect(downloadMedia).toHaveBeenCalledWith(FILE.url, FILE.filename),
    );
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
  it("lists who this file is evidence for and marks the picked one", async () => {
    loadFileText.mockResolvedValue(TEXT);
    useMemberStore.setState({
      members: [
        {
          id: "m1",
          firstName: "Johann",
          lastName: "Schmidt",
          maidenName: null,
          date: { birth: "1890", death: null },
        },
      ] as unknown as Member[],
    });
    useCitationStore.setState({
      citations: [
        {
          id: "c1",
          memberId: "m1",
          field: "first_name",
          documentId: "doc-1",
          fileId: "file-1",
          page: null,
          quote: "Johann",
          quotePrefix: "Taufschein",
          quoteSuffix: "Schmidt",
          note: null,
          createdAt: "2026-01-01T00:00:00Z",
          quoteFound: true,
        },
      ],
    });
    renderDialog();
    await screen.findByText("Johann Schmidt", {}, { timeout: 5000 });

    expect(screen.getByText("Cited in this file:")).toBeInTheDocument();
    const chip = screen.getByRole("button", {
      name: "Johann Schmidt · first name",
    });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("cites a selected passage as evidence", async () => {
    loadFileText.mockResolvedValue(TEXT);
    useDocumentStore.setState({
      documents: [
        {
          id: "doc-1",
          title: "Taufschein",
          description: null,
          documentDate: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          files: [FILE],
          memberIds: [],
          eventIds: [],
          storyIds: [],
        },
      ],
    });
    useMemberStore.setState({ members: [] });
    renderDialog();
    const paragraph = await screen.findByText(
      "Johann Schmidt",
      {},
      { timeout: 5000 },
    );

    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(paragraph.firstChild!, "Johann".length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(paragraph);

    fireEvent.click(
      await screen.findByRole("button", { name: "Use as evidence" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Add evidence" }),
    ).toBeInTheDocument();
    expect(screen.getByText("“Johann”")).toBeInTheDocument();
  });
});

describe("DocumentFileReaderTrigger", () => {
  const viewer = { id: "tree-1", name: "Tree", role: "viewer" as const };
  const owner = { id: "tree-1", name: "Tree", role: "owner" as const };

  beforeEach(() => {
    loadFileText.mockReset().mockResolvedValue(null);
    useDocumentStore.setState({ loadFileText });
  });

  it("opens the reader for viewers even when the file has no text", async () => {
    useWorkspaceStore.setState({ selectedTree: viewer });
    renderWithProviders(
      <DocumentFileReaderTrigger
        documentId="doc-1"
        file={{ ...FILE, hasText: false }}
      >
        <button type="button">{FILE.filename}</button>
      </DocumentFileReaderTrigger>,
    );
    fireEvent.click(screen.getByRole("button", { name: FILE.filename! }));
    expect(await screen.findByText("No text yet.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add text" }),
    ).not.toBeInTheDocument();
  });

  it("lets editors add text after opening a file without text", async () => {
    useWorkspaceStore.setState({ selectedTree: owner });
    renderWithProviders(
      <DocumentFileReaderTrigger
        documentId="doc-1"
        file={{ ...FILE, hasText: false }}
      >
        <button type="button">{FILE.filename}</button>
      </DocumentFileReaderTrigger>,
    );
    fireEvent.click(screen.getByRole("button", { name: FILE.filename! }));
    expect(
      await screen.findByRole("button", { name: "Add text" }),
    ).toBeInTheDocument();
  });
});
