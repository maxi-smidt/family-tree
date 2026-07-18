import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useTreeStore } from "@/hooks/useTreeStore";
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
      },
      {
        id: "link-1",
        kind: "link",
        filename: "Archive record",
        url: "https://example.com/record",
        mimeType: null,
        size: null,
        createdAt: "2026-01-01T00:00:00Z",
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
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    HTMLElement.prototype.scrollIntoView = vi.fn();
    useAuthStore.setState({ features: ["events"] });
    useTreeStore.setState({
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
  });

  it("starts collapsed, then filters to unlinked documents and opens linked people", () => {
    render(<DocumentsView />);

    expect(
      screen.queryByText("A scan of the certificate"),
    ).not.toBeInTheDocument();
    const documentCard = screen
      .getByText("Birth certificate")
      .closest('[data-slot="card"]');
    expect(documentCard).not.toBeNull();
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Show details",
      }),
    ).toHaveClass("border");
    expect(
      within(documentCard as HTMLElement).getByRole("button", {
        name: "Delete document",
      }),
    ).toHaveClass("text-destructive");
    expect(
      within(documentCard as HTMLElement).getByText("1 file"),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByText("1 external link"),
    ).toBeInTheDocument();
    expect(
      within(documentCard as HTMLElement).getByText("1 linked person"),
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
      within(documentCard as HTMLElement).getByText("Linked people"),
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

    const [filter] = screen.getAllByRole("combobox");
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole("option", { name: "Unlinked only" }));

    expect(screen.getByText("Archive index")).toBeInTheDocument();
    expect(screen.queryByText("Birth certificate")).not.toBeInTheDocument();

    fireEvent.click(filter);
    fireEvent.click(screen.getByRole("option", { name: "All documents" }));
    const restoredDocumentCard = screen
      .getByText("Birth certificate")
      .closest('[data-slot="card"]');
    expect(restoredDocumentCard).not.toBeNull();
    fireEvent.click(
      within(restoredDocumentCard as HTMLElement).getByRole("button", {
        name: "Show details",
      }),
    );
    fireEvent.click(
      within(restoredDocumentCard as HTMLElement).getByRole("button", {
        name: "Ada Lovelace",
      }),
    );

    expect(useMemberSheetStore.getState().setOpenSheet).toHaveBeenCalledWith(
      "tree-1",
      { memberId: "member-1", tab: "records", mode: "view" },
    );
  });
});
