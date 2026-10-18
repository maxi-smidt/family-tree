import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCitationStore } from "./useCitationStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import type { MemberFieldCitationDB } from "@/types/citation";

vi.mock("@/services/WorkspaceService");

const ROW: MemberFieldCitationDB = {
  id: "c1",
  member_id: "m1",
  field: "date_of_birth",
  document_id: "d1",
  document_file_id: "f1",
  page: 2,
  quote: "am zwölften März",
  quote_prefix: "ist ",
  quote_suffix: " geboren",
  note: null,
  created_by: "u1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  quote_found: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  useCitationStore.setState({ citations: [], initialized: false });
  useWorkspaceStore.setState({
    selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
  });
});

describe("useCitationStore", () => {
  it("loads and maps the workspace's citations once at a time", async () => {
    vi.mocked(WorkspaceService.getCitations).mockResolvedValue([ROW]);

    await Promise.all([
      useCitationStore.getState().refreshCitations(),
      useCitationStore.getState().refreshCitations(),
    ]);

    expect(WorkspaceService.getCitations).toHaveBeenCalledTimes(1);
    const state = useCitationStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.getForField("m1", "date_of_birth")[0]).toMatchObject({
      fileId: "f1",
      page: 2,
      quotePrefix: "ist ",
      quoteFound: true,
    });
    expect(state.getForDocument("d1")).toHaveLength(1);
  });

  it("drops a result for a workspace that is no longer open", async () => {
    let resolve: (rows: MemberFieldCitationDB[]) => void = () => {};
    vi.mocked(WorkspaceService.getCitations).mockReturnValue(
      new Promise((r) => (resolve = r)),
    );
    const pending = useCitationStore.getState().refreshCitations();
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-2", name: "Other", role: "owner" },
    });
    resolve([ROW]);
    await pending;
    expect(useCitationStore.getState().citations).toEqual([]);
  });

  it("adds, updates and removes a citation", async () => {
    vi.mocked(WorkspaceService.addCitation).mockResolvedValue(ROW);
    vi.mocked(WorkspaceService.updateCitation).mockResolvedValue({
      ...ROW,
      note: "Datum in Worten",
    });
    vi.mocked(WorkspaceService.removeCitation).mockResolvedValue(undefined);
    const store = useCitationStore.getState();
    const anchor = {
      fileId: "f1",
      page: 2,
      quote: "am zwölften März",
      quotePrefix: "ist ",
      quoteSuffix: " geboren",
      note: null,
    };

    await store.addCitation({
      memberId: "m1",
      field: "date_of_birth",
      documentId: "d1",
      ...anchor,
    });
    expect(WorkspaceService.addCitation).toHaveBeenCalledWith("tree-1", {
      memberId: "m1",
      field: "date_of_birth",
      documentId: "d1",
      ...anchor,
    });
    expect(useCitationStore.getState().citations).toHaveLength(1);

    await store.updateCitation("c1", { ...anchor, note: "Datum in Worten" });
    expect(useCitationStore.getState().citations[0].note).toBe(
      "Datum in Worten",
    );

    await store.removeCitation("c1");
    expect(WorkspaceService.removeCitation).toHaveBeenCalledWith(
      "tree-1",
      "c1",
    );
    expect(useCitationStore.getState().citations).toEqual([]);
  });
});
