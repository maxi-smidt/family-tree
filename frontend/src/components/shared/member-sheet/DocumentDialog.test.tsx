import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n/i18n";
import {
  DocumentUploadError,
  useDocumentStore,
} from "@/hooks/useDocumentStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import type { Document } from "@/types/document";
import { DocumentDialog } from "./DocumentDialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

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
    vi.clearAllMocks();
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

  it("defaults the title to the first attached file's name when empty", () => {
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    // DialogContent renders into a Radix portal, so it lands in
    // document.body rather than the render() container.
    const fileInput = document.body.querySelector('input[type="file"]');
    const file = new File(["content"], "report.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(screen.getByLabelText("Title *")).toHaveValue("report");
  });

  it("never overwrites a title the user already entered", () => {
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Title *"), {
      target: { value: "Archive index" },
    });
    const fileInput = document.body.querySelector('input[type="file"]');
    const file = new File(["content"], "report.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(screen.getByLabelText("Title *")).toHaveValue("Archive index");
  });

  it("marks the failed file row and keeps the dialog open when an upload fails", async () => {
    const onOpenChange = vi.fn();
    const addDocument = vi
      .fn()
      .mockRejectedValue(
        new DocumentUploadError([{ index: 0, filename: "report.pdf" }]),
      );
    useDocumentStore.setState({ addDocument });

    render(<DocumentDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText("Title *"), {
      target: { value: "Archive index" },
    });
    const fileInput = document.body.querySelector('input[type="file"]');
    const file = new File(["content"], "report.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(addDocument).toHaveBeenCalled());
    await screen.findByText("Upload failed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Could not upload report.pdf. Check your connection and try saving again.",
    );
  });
});
