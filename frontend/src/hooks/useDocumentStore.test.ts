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
const FILE = new File(["pdf bytes"], "scan.pdf", { type: "application/pdf" });

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
  it("creates the document in one atomic save and refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.saveDocument).mockResolvedValue(DOC_DB);
    vi.mocked(TreeService.getDocuments).mockResolvedValue([DOC_DB]);

    const created = await useDocumentStore
      .getState()
      .addDocument(INPUT, ["m1"]);

    expect(TreeService.saveDocument).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      expect.objectContaining({
        title: "Birth Certificate",
        member_ids: ["m1"],
        attached_upload_ids: [],
        added_links: [],
        removed_file_ids: [],
        renamed_files: [],
      }),
    );
    expect(TreeService.getDocuments).toHaveBeenCalled();
    expect(created?.id).toBe("d1");
  });

  it("allows a document without linked people", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.saveDocument).mockResolvedValue({
      ...DOC_DB,
      member_ids: [],
    });
    vi.mocked(TreeService.getDocuments).mockResolvedValue([
      { ...DOC_DB, member_ids: [] },
    ]);

    await useDocumentStore.getState().addDocument(INPUT, []);

    expect(TreeService.saveDocument).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      expect.objectContaining({ member_ids: [] }),
    );
  });

  it("stages files first, then attaches them by id in the save", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.stageDocumentUpload).mockResolvedValue({
      id: "upload-1",
      filename: "scan.pdf",
      mime_type: "application/pdf",
      size: 9,
    });
    vi.mocked(TreeService.saveDocument).mockResolvedValue(DOC_DB);
    vi.mocked(TreeService.getDocuments).mockResolvedValue([DOC_DB]);

    await useDocumentStore.getState().addDocument(INPUT, ["m1"], {
      addedFiles: [{ filename: "scan.pdf", file: FILE }],
      addedLinks: [{ url: "https://example.com", label: "Record" }],
      removedIds: [],
      renamed: [],
    });

    expect(TreeService.stageDocumentUpload).toHaveBeenCalledWith(
      TREE_ID,
      FILE,
      "scan.pdf",
    );
    const payload = vi.mocked(TreeService.saveDocument).mock.calls[0][2];
    expect(payload.attached_upload_ids).toEqual(["upload-1"]);
    expect(payload.added_links).toEqual([
      {
        id: expect.any(String),
        url: "https://example.com",
        filename: "Record",
      },
    ]);
    // The save must run only after every file has finished staging.
    const stageOrder = vi.mocked(TreeService.stageDocumentUpload).mock
      .invocationCallOrder[0];
    const saveOrder = vi.mocked(TreeService.saveDocument).mock
      .invocationCallOrder[0];
    expect(stageOrder).toBeLessThan(saveOrder);
  });

  it("propagates a failed save without extra cleanup calls", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.stageDocumentUpload).mockResolvedValue({
      id: "upload-1",
      filename: "scan.pdf",
      mime_type: "application/pdf",
      size: 9,
    });
    vi.mocked(TreeService.saveDocument).mockRejectedValue(
      new Error("save failed"),
    );

    await expect(
      useDocumentStore.getState().addDocument(INPUT, ["m1"], {
        addedFiles: [{ filename: "scan.pdf", file: FILE }],
        addedLinks: [],
        removedIds: [],
        renamed: [],
      }),
    ).rejects.toThrow("save failed");

    // The server applies the save atomically and reaps unclaimed uploads, so
    // there is no orphan document to delete client-side.
    expect(TreeService.removeDocument).not.toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    const created = await useDocumentStore
      .getState()
      .addDocument(INPUT, ["m1"]);
    expect(created).toBeNull();
    expect(TreeService.saveDocument).not.toHaveBeenCalled();
  });
});

describe("useDocumentStore — updateDocument", () => {
  it("sends metadata, members and file ops in one save request", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.saveDocument).mockResolvedValue(DOC_DB);
    vi.mocked(TreeService.getDocuments).mockResolvedValue([DOC_DB]);

    await useDocumentStore
      .getState()
      .updateDocument("d1", INPUT, ["m1", "m2"], {
        addedFiles: [],
        addedLinks: [],
        removedIds: ["f-old"],
        renamed: [{ id: "f-keep", filename: "renamed.pdf" }],
      });

    expect(TreeService.saveDocument).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      expect.objectContaining({
        title: "Birth Certificate",
        member_ids: ["m1", "m2"],
        attached_upload_ids: [],
        removed_file_ids: ["f-old"],
        renamed_files: [{ id: "f-keep", filename: "renamed.pdf" }],
      }),
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
