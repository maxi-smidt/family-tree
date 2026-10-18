import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { useWorkspaceNavStore } from "@/hooks/useWorkspaceNavStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useActiveViewStore } from "@/hooks/useActiveViewStore";
import type { DocumentSearchResult } from "@/types/document";
import type { Workspace } from "@/types/workspace";
import type { SectionDB } from "@/types/section";
import type { SavedViewDB } from "@/types/savedView";
import { GlobalSearch } from "./GlobalSearch";

const OPEN: Workspace = { id: "ws-1", name: "Smidt family", role: "owner" };
const OTHER: Workspace = { id: "ws-2", name: "Smith cousins", role: "viewer" };

const SECTION: SectionDB = {
  id: "sec-1",
  workspace_id: "ws-1",
  name: "Smidt line",
  position: 0,
  created_at: "2026-01-01T00:00:00Z",
  member_count: 4,
  can_write: true,
};

const VIEW: SavedViewDB = {
  id: "view-1",
  workspace_id: "ws-1",
  owner_id: "me",
  name: "Smidt grandparents",
  focus_member_id: null,
  section_ids: [],
  ancestor_depth: 2,
  descendant_depth: 2,
  include_partners: true,
  filters: {},
  config_version: 1,
  version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_opened: null,
  positions: [],
};

const DOCUMENT_RESULT: DocumentSearchResult = {
  hits: [
    {
      documentId: "doc-1",
      documentTitle: "Taufbuch Graz",
      documentDate: null,
      field: "text",
      fileId: "file-1",
      fileName: "scan.png",
      page: 3,
      snippet: "Pate war Johann Weber aus Graz",
      highlights: [[16, 21]],
      matchCount: 2,
      matchedWords: ["weber"],
    },
  ],
  total: 1,
  truncated: false,
  fuzzy: false,
};

const openPalette = (query: string) => {
  render(<GlobalSearch />);
  fireEvent.click(screen.getByRole("button"));
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: query },
  });
};

describe("GlobalSearch", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [OPEN, OTHER],
      selectedTree: OPEN,
      selectTree: vi.fn().mockResolvedValue(undefined),
    });
    useSectionStore.setState({ sections: [SECTION], initialized: true });
    useSavedViewStore.setState({
      views: [VIEW],
      initialized: true,
      openSavedView: vi.fn().mockResolvedValue(undefined),
    });
    useMemberStore.setState({
      members: [],
      focusSection: vi.fn().mockResolvedValue(undefined),
    });
    useWorkspaceNavStore.getState().clear();
    useNavigationStore.setState({ pendingView: null });
    useDocumentStore.setState({
      focus: null,
      searchDocuments: vi.fn().mockResolvedValue(null),
    });
  });

  it("says so when the document search fails", async () => {
    useDocumentStore.setState({
      searchDocuments: vi.fn().mockRejectedValue(new Error("404")),
    });
    openPalette("weber");
    expect(
      await screen.findByText("Documents couldn't be searched right now."),
    ).toBeInTheDocument();
  });

  it("searches document texts and opens the matching file", async () => {
    const searchDocuments = vi.fn().mockResolvedValue(DOCUMENT_RESULT);
    useDocumentStore.setState({ searchDocuments });
    openPalette("weber");
    expect(await screen.findByText("Taufbuch Graz")).toBeInTheDocument();
    expect(searchDocuments).toHaveBeenCalledWith("weber", 6);
    expect(screen.getByText("Weber").tagName).toBe("MARK");
    expect(screen.getByText("scan.png · p. 3")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Taufbuch Graz"));
    expect(useDocumentStore.getState().focus).toEqual({
      documentId: "doc-1",
      fileId: "file-1",
      words: ["weber"],
    });
    expect(useActiveViewStore.getState().mediaSection).toBe("documents");
    expect(useActiveViewStore.getState().activeView).toBe("media-view");
  });

  it("lists matching sections, saved views and other workspaces", () => {
    openPalette("smi");
    expect(screen.getByText("Smidt line")).toBeInTheDocument();
    expect(screen.getByText("Smidt grandparents")).toBeInTheDocument();
    expect(screen.getByText("Smith cousins")).toBeInTheDocument();
    // The workspace already open is not offered as a switch target.
    expect(screen.queryByText("Smidt family")).not.toBeInTheDocument();
  });

  it("opens a section on the tree", () => {
    openPalette("line");
    fireEvent.click(screen.getByText("Smidt line"));
    expect(useWorkspaceNavStore.getState().selectedSectionId).toBe("sec-1");
    expect(useMemberStore.getState().focusSection).toHaveBeenCalledWith(
      "sec-1",
    );
    expect(useNavigationStore.getState().pendingView).toBe("tree-view");
  });

  it("opens a saved view on the tree", () => {
    openPalette("grand");
    fireEvent.click(screen.getByText("Smidt grandparents"));
    expect(useWorkspaceNavStore.getState().selectedSavedViewId).toBe("view-1");
    expect(useSavedViewStore.getState().openSavedView).toHaveBeenCalledWith(
      "view-1",
    );
    expect(useNavigationStore.getState().pendingView).toBe("tree-view");
  });

  it("switches to another workspace", () => {
    openPalette("cousins");
    fireEvent.click(screen.getByText("Smith cousins"));
    expect(useWorkspaceStore.getState().selectTree).toHaveBeenCalledWith(OTHER);
  });
});
