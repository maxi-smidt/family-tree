import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "./useDocumentStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { DocumentDB } from "@/types/document";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");
vi.mock("@/hooks/useStorageStore", () => ({
  useStorageStore: { getState: () => ({ refreshStorageUsage: vi.fn() }) },
}));

const TREE_ID = "tree-doc";
const TREE: Tree = { id: TREE_ID, name: "Doc Tree", role: "owner" };

const DOC_DB: DocumentDB = {
  id: "d1",
  title: "Birth Certificate",
  description: null,
  document_date: "1950",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  files: [],
  member_ids: ["m1"],
  event_ids: [],
  story_ids: [],
};

const INPUT = { title: "Birth Certificate", description: "", documentDate: "" };

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: [], initialized: false });
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useDocumentStore — refreshDocuments", () => {
  it("clears documents when no tree is selected", async () => {
    useDocumentStore.setState({ documents: [{ id: "stale" } as never] });

    await useDocumentStore.getState().refreshDocuments();

    expect(useDocumentStore.getState().documents).toHaveLength(0);
    expect(TreeService.getDocuments).not.toHaveBeenCalled();
  });

  it("fetches and maps documents", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getDocuments).mockResolvedValue([DOC_DB]);

    await useDocumentStore.getState().refreshDocuments();

    const docs = useDocumentStore.getState().documents;
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("d1");
    expect(docs[0].title).toBe("Birth Certificate");
    expect(docs[0].memberIds).toEqual(["m1"]);
  });

  it("drops stale data when the tree changed mid-flight", async () => {
    let resolve!: (v: DocumentDB[]) => void;
    const pending = new Promise<DocumentDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(TreeService.getDocuments).mockReturnValue(pending);
    useTreeStore.setState({ selectedTree: TREE });

    const p = useDocumentStore.getState().refreshDocuments(TREE_ID);
    useTreeStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([DOC_DB]);
    await p;

    expect(useDocumentStore.getState().documents).toHaveLength(0);
  });
});

describe("useDocumentStore — getDocumentsForMember", () => {
  it("returns documents that mention the given member", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getDocuments).mockResolvedValue([
      DOC_DB,
      { ...DOC_DB, id: "d2", title: "Other", member_ids: ["m2"] },
    ]);

    await useDocumentStore.getState().refreshDocuments();

    const result = useDocumentStore.getState().getDocumentsForMember("m1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("d1");
  });
});

describe("useDocumentStore — addDocument", () => {
  it("creates the document and refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.addDocument).mockResolvedValue(DOC_DB);
    vi.mocked(TreeService.getDocuments).mockResolvedValue([DOC_DB]);

    const created = await useDocumentStore
      .getState()
      .addDocument(INPUT, ["m1"]);

    expect(TreeService.addDocument).toHaveBeenCalledWith(TREE_ID, INPUT, [
      "m1",
    ]);
    expect(TreeService.getDocuments).toHaveBeenCalled();
    expect(created?.id).toBe("d1");
  });

  it("applies queued file and link ops", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.addDocument).mockResolvedValue(DOC_DB);
    vi.mocked(TreeService.addDocumentFile).mockResolvedValue({} as never);
    vi.mocked(TreeService.addDocumentLink).mockResolvedValue({} as never);
    vi.mocked(TreeService.getDocuments).mockResolvedValue([DOC_DB]);

    await useDocumentStore.getState().addDocument(INPUT, ["m1"], {
      addedFiles: [
        { filename: "scan.pdf", dataUrl: "data:application/pdf;base64,AAA" },
      ],
      addedLinks: [{ url: "https://example.com", label: "Record" }],
      removedIds: [],
      renamed: [],
    });

    expect(TreeService.addDocumentFile).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      "scan.pdf",
      "data:application/pdf;base64,AAA",
    );
    expect(TreeService.addDocumentLink).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      "https://example.com",
      "Record",
    );
  });

  it("does nothing when no tree is selected", async () => {
    const created = await useDocumentStore
      .getState()
      .addDocument(INPUT, ["m1"]);
    expect(created).toBeNull();
    expect(TreeService.addDocument).not.toHaveBeenCalled();
  });
});

describe("useDocumentStore — updateDocument", () => {
  it("updates the document, replaces members and applies file ops", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.updateDocument).mockResolvedValue(DOC_DB);
    vi.mocked(TreeService.setDocumentMembers).mockResolvedValue(undefined);
    vi.mocked(TreeService.removeDocumentFile).mockResolvedValue(undefined);
    vi.mocked(TreeService.renameDocumentFile).mockResolvedValue({} as never);
    vi.mocked(TreeService.getDocuments).mockResolvedValue([DOC_DB]);

    await useDocumentStore
      .getState()
      .updateDocument("d1", INPUT, ["m1", "m2"], {
        addedFiles: [],
        addedLinks: [],
        removedIds: ["f-old"],
        renamed: [{ id: "f-keep", filename: "renamed.pdf" }],
      });

    expect(TreeService.updateDocument).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      INPUT,
    );
    expect(TreeService.setDocumentMembers).toHaveBeenCalledWith(TREE_ID, "d1", [
      "m1",
      "m2",
    ]);
    expect(TreeService.removeDocumentFile).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      "f-old",
    );
    expect(TreeService.renameDocumentFile).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      "f-keep",
      "renamed.pdf",
    );
  });
});

describe("useDocumentStore — removeDocument", () => {
  it("deletes the document then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.removeDocument).mockResolvedValue(undefined);
    vi.mocked(TreeService.getDocuments).mockResolvedValue([]);

    await useDocumentStore.getState().removeDocument("d1");

    expect(TreeService.removeDocument).toHaveBeenCalledWith(TREE_ID, "d1");
    expect(TreeService.getDocuments).toHaveBeenCalled();
  });
});

describe("useDocumentStore — clear", () => {
  it("empties the documents slice", () => {
    useDocumentStore.setState({
      documents: [{ id: "d1" } as never],
      initialized: true,
    });

    useDocumentStore.getState().clear();

    expect(useDocumentStore.getState().documents).toHaveLength(0);
    expect(useDocumentStore.getState().initialized).toBe(false);
  });
});
