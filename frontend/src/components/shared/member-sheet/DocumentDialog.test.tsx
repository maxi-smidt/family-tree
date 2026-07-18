import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import type { Document } from "@/types/document";
import { DocumentDialog } from "./DocumentDialog";

const UNLINKED_DOCUMENT: Document = {
  id: "document-1",
  title: "Archive index",
  description: null,
  documentDate: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  files: [],
  memberIds: [],
  eventIds: [],
  storyIds: [],
};

describe("DocumentDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useMemberStore.setState({ members: [] });
    useDocumentStore.setState({
      addDocument: vi.fn(),
      updateDocument: vi.fn(),
    });
    useUnsavedChangesStore.setState({
      guards: {},
      pendingNav: null,
      dialogOpen: false,
    });
  });

  it("enables saving a titled document without linked people", () => {
    render(<DocumentDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Title *"), {
      target: { value: "Archive index" },
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("enables editing a document without linked people", () => {
    render(
      <DocumentDialog
        open
        onOpenChange={vi.fn()}
        document={UNLINKED_DOCUMENT}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
