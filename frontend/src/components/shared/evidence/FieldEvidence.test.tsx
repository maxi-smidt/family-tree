import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useCitationStore } from "@/hooks/useCitationStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { MemberFieldCitation } from "@/types/citation";
import type { Document } from "@/types/document";
import type { Member } from "@/types/member";
import { FieldEvidence } from "./FieldEvidence";
import { CitationDialog } from "./CitationDialog";
import { EvidenceChangeWarning } from "./EvidenceChangeWarning";

const MEMBER = {
  id: "m1",
  firstName: "Johann",
  lastName: "Weber",
  date: { birth: "1890-03-12", death: null },
} as unknown as Member;

const DOCUMENT: Document = {
  id: "d1",
  title: "Taufbuchauszug St. Martin",
  description: null,
  documentDate: "1890",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  files: [
    {
      id: "f1",
      kind: "file",
      filename: "taufbuch_1890.jpg",
      url: "/api/media/taufbuch.jpg",
      mimeType: "image/jpeg",
      size: 10,
      createdAt: "2026-01-01T00:00:00Z",
      hasText: true,
      transcriptionStatus: null,
      transcriptionError: null,
    },
  ],
  memberIds: ["m1"],
  eventIds: [],
  storyIds: [],
};

const OTHER_DOCUMENT: Document = {
  ...DOCUMENT,
  id: "d2",
  title: "Brief an Josef",
  files: [],
  memberIds: [],
};

const CITATION: MemberFieldCitation = {
  id: "c1",
  memberId: "m1",
  field: "date_of_birth",
  documentId: "d1",
  fileId: "f1",
  page: 1,
  quote: "am zwölften März",
  quotePrefix: "ist",
  quoteSuffix: "geboren",
  note: "Datum in Worten",
  createdAt: "2026-01-01T00:00:00Z",
  quoteFound: true,
};

const addCitation = vi.fn();
const removeCitation = vi.fn();

beforeEach(() => {
  addCitation.mockReset().mockResolvedValue(CITATION);
  removeCitation.mockReset().mockResolvedValue(undefined);
  useWorkspaceStore.setState({
    selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
  });
  useCitationStore.setState({
    citations: [CITATION],
    initialized: true,
    addCitation,
    removeCitation,
  });
  useDocumentStore.setState({
    documents: [DOCUMENT, OTHER_DOCUMENT],
    initialized: true,
    refreshDocuments: vi.fn().mockResolvedValue(undefined),
  });
  useMemberStore.setState({ members: [MEMBER] });
});

describe("FieldEvidence", () => {
  it("lists the documents cited for a field", async () => {
    render(<FieldEvidence member={MEMBER} field="date_of_birth" />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "1 document cited for date of birth",
      }),
    );

    const popover = await screen.findByRole("dialog");
    expect(
      within(popover).getByText("Evidence for date of birth"),
    ).toBeInTheDocument();
    expect(
      within(popover).getByText("Taufbuchauszug St. Martin"),
    ).toBeInTheDocument();
    expect(
      within(popover).getByText("taufbuch_1890.jpg · page 1"),
    ).toBeInTheDocument();
    expect(within(popover).getByText("am zwölften März")).toBeInTheDocument();
    expect(within(popover).getByText("Datum in Worten")).toBeInTheDocument();
    expect(
      within(popover).getByRole("button", { name: "Open in reader" }),
    ).toBeInTheDocument();
  });

  it("removes a citation and offers to undo", async () => {
    render(<FieldEvidence member={MEMBER} field="date_of_birth" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "1 document cited for date of birth",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove evidence" }),
    );
    await waitFor(() => expect(removeCitation).toHaveBeenCalledWith("c1"));
  });

  it("warns when a cited quote is no longer in the text", async () => {
    useCitationStore.setState({
      citations: [{ ...CITATION, quoteFound: false }],
    });
    render(<FieldEvidence member={MEMBER} field="date_of_birth" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "1 document cited for date of birth",
      }),
    );
    expect(
      await screen.findByText(
        "This passage is no longer in the file's text. Pick it again.",
      ),
    ).toBeInTheDocument();
  });

  it("shows nothing to readers when a field has no evidence", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "viewer" },
    });
    const { container } = render(
      <FieldEvidence member={MEMBER} field="date_of_death" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers editors to add evidence for an uncited field", async () => {
    render(<FieldEvidence member={MEMBER} field="date_of_death" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add evidence for date of death" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Add evidence for date of death",
      }),
    ).toBeInTheDocument();
  });
});

describe("CitationDialog", () => {
  it("cites a whole document, listing the person's documents first", async () => {
    render(
      <CitationDialog
        open
        onOpenChange={() => {}}
        memberId="m1"
        field="date_of_birth"
      />,
    );

    expect(screen.getByText("Linked to Johann")).toBeInTheDocument();
    expect(screen.getByText("Other documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Brief an Josef/ }));
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "nennt nur das Jahr" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add evidence" }));

    await waitFor(() =>
      expect(addCitation).toHaveBeenCalledWith({
        memberId: "m1",
        field: "date_of_birth",
        documentId: "d2",
        fileId: null,
        page: null,
        quote: null,
        quotePrefix: null,
        quoteSuffix: null,
        note: "nennt nur das Jahr",
      }),
    );
    // Citing an unlinked document links it, so the list is reloaded.
    expect(useDocumentStore.getState().refreshDocuments).toHaveBeenCalled();
  });

  it("asks for the person and fact when started from a passage", async () => {
    useDocumentStore.setState({
      loadFileText: vi.fn().mockResolvedValue(null),
    });
    render(
      <CitationDialog
        open
        onOpenChange={() => {}}
        draft={{
          documentId: "d1",
          fileId: "f1",
          quote: "Johann Georg Weber",
          quotePrefix: "",
          quoteSuffix: ", Sohn",
        }}
        suggestedMemberIds={["m1"]}
      />,
    );

    expect(screen.getByRole("button", { name: "Add evidence" })).toBeDisabled();
    expect(screen.getByText("“Johann Georg Weber”")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Johann Weber", pressed: true }),
    ).toBeInTheDocument();
  });
});

describe("EvidenceChangeWarning", () => {
  it("asks about the evidence once a cited value changes", async () => {
    const onUndo = vi.fn();
    const { rerender } = render(
      <EvidenceChangeWarning
        memberId="m1"
        field="date_of_birth"
        baseline="1890-03-12"
        value="1890-03-12"
        onUndo={onUndo}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(
      <EvidenceChangeWarning
        memberId="m1"
        field="date_of_birth"
        baseline="1890-03-12"
        value="1890-03-21"
        onUndo={onUndo}
      />,
    );
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("It says “am zwölften März”.");

    fireEvent.click(
      within(warning).getByRole("button", { name: "Undo change" }),
    );
    expect(onUndo).toHaveBeenCalled();

    fireEvent.click(
      within(warning).getByRole("button", { name: "Remove from this field" }),
    );
    await waitFor(() => expect(removeCitation).toHaveBeenCalledWith("c1"));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});
