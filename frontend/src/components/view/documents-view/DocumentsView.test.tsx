import { fireEvent, render, screen } from "@testing-library/react";
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
    files: [],
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

  it("filters to unlinked documents and opens a linked person in their records", () => {
    render(<DocumentsView />);

    const [filter] = screen.getAllByRole("combobox");
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole("option", { name: "Unlinked only" }));

    expect(screen.getByText("Archive index")).toBeInTheDocument();
    expect(screen.queryByText("Birth certificate")).not.toBeInTheDocument();

    fireEvent.click(filter);
    fireEvent.click(screen.getByRole("option", { name: "All documents" }));
    fireEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));

    expect(useMemberSheetStore.getState().setOpenSheet).toHaveBeenCalledWith(
      "tree-1",
      { memberId: "member-1", tab: "records", mode: "view" },
    );
  });
});
