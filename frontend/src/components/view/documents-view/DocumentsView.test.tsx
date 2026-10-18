import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { Document } from "@/types/document";
import { DocumentsView } from "./DocumentsView";

vi.mock("@/components/shared/member-sheet/DocumentDialog", () => ({
  DocumentDialog: () => null,
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
