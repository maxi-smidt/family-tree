import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { openMedia } from "@/hooks/useMediaUrl";
import type { Document } from "@/types/document";
import { DocumentsView } from "./DocumentsView";

vi.mock("@/components/shared/member-sheet/DocumentDialog", () => ({
  DocumentDialog: () => null,
}));
vi.mock("@/hooks/useMediaUrl", () => ({
  openMedia: vi.fn().mockResolvedValue(undefined),
  downloadMedia: vi.fn().mockResolvedValue(undefined),
  useMediaUrl: () => undefined,
}));

const documents: Document[] = [
  {
    id: "linked-document",
    title: "Birth certificate",
    description: "A scan of the certificate",
    documentDate: "1900",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    files: [
      {
        id: "file-1",
        kind: "file",
        filename: "birth-certificate.pdf",
        url: "/api/media/file-1",
        mimeType: "application/pdf",
        size: 123,
        createdAt: "2026-01-01T00:00:00Z",
        hasText: false,
        transcriptionStatus: null,
        transcriptionError: null,
      },
      {
        id: "link-1",
        kind: "link",
        filename: "Archive record",
        url: "https://example.com/record",
        mimeType: null,
        size: null,
        createdAt: "2026-01-01T00:00:00Z",
        hasText: false,
        transcriptionStatus: null,
        transcriptionError: null,
      },
    ],
    memberIds: ["member-1"],
    eventIds: [],
    storyIds: [],
  },
  {
    id: "unlinked-document",
    title: "Archive index",
    description: null,
    documentDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    files: [],
    memberIds: [],
    eventIds: [],
    storyIds: [],
  },
];

describe("DocumentsView", () => {
  beforeEach(() => {
    vi.mocked(openMedia).mockClear();
    useWorkspaceStore.setState({
      isReady: true,
      selectedTree: { id: "tree-1", role: "owner" } as never,
    });
    useDocumentStore.setState({
      documents,
      initialized: true,
      refreshDocuments: vi.fn(),
      removeDocument: vi.fn(),
    });
    useMemberStore.setState({
      members: [
        { id: "member-1", firstName: "Ada", lastName: "Lovelace" },
      ] as never,
    });
    useEventStore.setState({
      initialized: true,
      events: [],
      refreshEvents: vi.fn(),
    });
    useStoryStore.setState({
      initialized: true,
      stories: [],
      refreshStories: vi.fn(),
    });
    useMemberSheetStore.setState({ openSheets: {}, setOpenSheet: vi.fn() });
    useDocumentStore.setState({
      focus: null,
      searchDocuments: vi.fn().mockResolvedValue(null),
      loadFileText: vi.fn().mockResolvedValue(null),
    });
  });

  it("finds documents by their file text and shows where", async () => {
    useDocumentStore.setState({
      searchDocuments: vi.fn().mockResolvedValue({
        hits: [
          {
            documentId: "unlinked-document",
            documentTitle: "Archive index",
            documentDate: null,
            field: "text",
            fileId: "file-9",
            fileName: "index.png",
            page: 2,
            snippet: "… Johann Weber, Bauer",
            highlights: [[9, 14]],
            matchCount: 1,
            matchedWords: ["weber"],
          },
        ],
        total: 1,
        truncated: false,
        fuzzy: false,
      }),
    });
    render(<DocumentsView />);
    fireEvent.change(screen.getByPlaceholderText("Search documents…"), {
      target: { value: "weber" },
    });
    expect(await screen.findByText("In index.png, p. 2:")).toBeInTheDocument();
    expect(screen.getByText("Archive index")).toBeInTheDocument();
    expect(screen.queryByText("Birth certificate")).not.toBeInTheDocument();
  });

  it("filters out a document when any of its files has a transcription", async () => {
    const transcribed: Document = {
      ...documents[0],
      id: "transcribed",
      title: "Transcribed letter",
      files: [
        ...documents[0].files,
        { ...documents[0].files[0], id: "text-file", hasText: true },
      ],
    };
    useDocumentStore.setState({ documents: [...documents, transcribed] });
    render(<DocumentsView />);

    const filter = screen.getByRole("radio", { name: /Without transcription/ });
    expect(filter).toHaveTextContent("2");
    fireEvent.click(filter);
    expect(screen.getByText("Birth certificate")).toBeInTheDocument();
    expect(screen.getByText("Archive index")).toBeInTheDocument();
    expect(screen.queryByText("Transcribed letter")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search documents…"), {
      target: { value: "certificate" },
    });
    expect(screen.getByText("Birth certificate")).toBeInTheDocument();
    expect(screen.queryByText("Archive index")).not.toBeInTheDocument();

    // Completing a transcription updates both the count and the results.
    act(() =>
      useDocumentStore.setState({
        documents: [
          {
            ...documents[0],
            files: [{ ...documents[0].files[0], hasText: true }],
          },
          documents[1],
          transcribed,
        ],
      }),
    );
    expect(
      screen.getByRole("radio", { name: /Without transcription/ }),
    ).toHaveTextContent("1");
    expect(screen.queryByText("Birth certificate")).not.toBeInTheDocument();
    expect(
      await screen.findByText("No documents match these filters."),
    ).toBeInTheDocument();
  });

  it("clears the transcription filter when focusing a document from search", async () => {
    useDocumentStore.setState({
      documents: [
        {
          ...documents[0],
          files: [{ ...documents[0].files[0], hasText: true }],
        },
        documents[1],
      ],
    });
    render(<DocumentsView />);
    fireEvent.click(
      screen.getByRole("radio", { name: /Without transcription/ }),
    );
    expect(screen.queryByText("Birth certificate")).not.toBeInTheDocument();

    act(() =>
      useDocumentStore.getState().setFocus({
        documentId: "linked-document",
        fileId: null,
        words: [],
      }),
    );
    expect(await screen.findByText("Birth certificate")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^All/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("opens the file text of a document picked in search", async () => {
    const loadFileText = vi.fn().mockResolvedValue({
      fileId: "file-1",
      language: null,
      markdown: "Geboren: Ada",
      source: "manual",
      editedBy: null,
      editedAt: null,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    useDocumentStore.setState({
      loadFileText,
      focus: {
        documentId: "linked-document",
        fileId: "file-1",
        words: ["ada"],
      },
    });
    render(<DocumentsView />);
    expect(
      await screen.findByText("Geboren: Ada", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(loadFileText).toHaveBeenCalledWith("linked-document", "file-1");
    expect(useDocumentStore.getState().focus).toBeNull();
  });

  it("opens file clicks in the reader and uses the adjacent icon for another window", async () => {
    render(<DocumentsView />);
    const row = screen
      .getByText("Birth certificate")
      .closest('[data-slot="document-row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Show details" }));
    fireEvent.click(
      within(row).getByRole("button", { name: "birth-certificate.pdf" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Text of birth-certificate.pdf",
    });
    expect(openMedia).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(
      within(row).getByRole("button", { name: "Open in another window" }),
    );
    expect(openMedia).toHaveBeenCalledWith("/api/media/file-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Hide details" }),
    ).toBeInTheDocument();
  });

  it("does not open any file when a document row is double-clicked", () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<DocumentsView />);
    fireEvent.doubleClick(screen.getByText("Birth certificate"));
    expect(openMedia).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openWindow.mockRestore();
  });

  it("starts collapsed, then filters to unlinked documents and opens linked people", () => {
    render(<DocumentsView />);

    expect(
      screen.queryByText("A scan of the certificate"),
    ).not.toBeInTheDocument();
    const documentCard = screen
      .getByText("Birth certificate")
      .closest('[data-slot="document-row"]');
    expect(documentCard).not.toBeNull();
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Show details",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Delete document",
      }),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByText("1 file · 1 external link"),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Open Ada Lovelace",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Show details",
      }),
    );
    expect(
      within(documentCard as HTMLElement).getByText(
        "A scan of the certificate",
      ),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Hide details",
      }),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByText("Attachments"),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByText("External links"),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "birth-certificate.pdf",
      }),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Archive record",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Hide details",
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: /Not linked/ }));

    expect(screen.getByText("Archive index")).toBeInTheDocument();
    expect(screen.queryByText("Birth certificate")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /All/ }));
    const restoredDocumentCard = screen
      .getByText("Birth certificate")
      .closest('[data-slot="document-row"]');
    expect(restoredDocumentCard).not.toBeNull();
    fireEvent.click(
      within(restoredDocumentCard as HTMLElement).getByRole("button", {
        name: "Open Ada Lovelace",
      }),
    );

    expect(useMemberSheetStore.getState().setOpenSheet).toHaveBeenCalledWith(
      "tree-1",
      { memberId: "member-1", tab: "records", mode: "view" },
    );
  });

  it("expands and collapses when clicking the row, without the edit button toggling it", () => {
    render(<DocumentsView />);
    const documentCard = screen
      .getByText("Birth certificate")
      .closest('[data-slot="document-row"]') as HTMLElement;

    fireEvent.click(within(documentCard).getByText("Birth certificate"));
    expect(
      within(documentCard).getByText("A scan of the certificate"),
    ).toBeInTheDocument();
    expect(
      within(documentCard).getByRole("button", { name: "Hide details" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(documentCard).getByRole("button", { name: "Edit document" }),
    );
    expect(
      within(documentCard).getByText("A scan of the certificate"),
    ).toBeInTheDocument();
    expect(
      within(documentCard).getByRole("button", { name: "Hide details" }),
    ).toBeInTheDocument();

    fireEvent.click(within(documentCard).getByText("Birth certificate"));
    expect(
      within(documentCard).queryByText("A scan of the certificate"),
    ).not.toBeInTheDocument();
  });
});
