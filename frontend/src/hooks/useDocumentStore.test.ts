import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentUploadError, useDocumentStore } from "./useDocumentStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { DocumentDB } from "@/types/document";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");
vi.mock("@/hooks/useStorageStore", () => ({
  useStorageStore: { getState: () => ({ refreshStorageUsage: vi.fn() }) },
}));

const TREE_ID = "tree-doc";
const TREE: Workspace = { id: TREE_ID, name: "Doc Workspace", role: "owner" };

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
const FILE2 = new File(["pdf bytes 2"], "scan2.pdf", {
  type: "application/pdf",
});
const FILE3 = new File(["pdf bytes 3"], "scan3.pdf", {
  type: "application/pdf",
});

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: [], initialized: false });
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useDocumentStore — refreshDocuments", () => {
  it("clears documents when no tree is selected", async () => {
    useDocumentStore.setState({ documents: [{ id: "stale" } as never] });

    await useDocumentStore.getState().refreshDocuments();

    expect(useDocumentStore.getState().documents).toHaveLength(0);
    expect(WorkspaceService.getDocuments).not.toHaveBeenCalled();
  });

  it("fetches and maps documents", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([DOC_DB]);

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
    vi.mocked(WorkspaceService.getDocuments).mockReturnValue(pending);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useDocumentStore.getState().refreshDocuments(TREE_ID);
    useWorkspaceStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([DOC_DB]);
    await p;

    expect(useDocumentStore.getState().documents).toHaveLength(0);
  });
});

describe("useDocumentStore — getDocumentsForMember", () => {
  it("returns documents that mention the given member", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([
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
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.saveDocument).mockResolvedValue(DOC_DB);
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([DOC_DB]);

    const created = await useDocumentStore
      .getState()
      .addDocument(INPUT, ["m1"]);

    expect(WorkspaceService.saveDocument).toHaveBeenCalledWith(
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
    expect(WorkspaceService.getDocuments).toHaveBeenCalled();
    expect(created?.id).toBe("d1");
  });

  it("allows a document without linked people", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.saveDocument).mockResolvedValue({
      ...DOC_DB,
      member_ids: [],
    });
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([
      { ...DOC_DB, member_ids: [] },
    ]);

    await useDocumentStore.getState().addDocument(INPUT, []);

    expect(WorkspaceService.saveDocument).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      expect.objectContaining({ member_ids: [] }),
    );
  });

  it("stages files first, then attaches them by id in the save", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.stageDocumentUpload).mockResolvedValue({
      id: "upload-1",
      filename: "scan.pdf",
      mime_type: "application/pdf",
      size: 9,
    });
    vi.mocked(WorkspaceService.saveDocument).mockResolvedValue(DOC_DB);
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([DOC_DB]);

    await useDocumentStore.getState().addDocument(INPUT, ["m1"], {
      addedFiles: [{ filename: "scan.pdf", file: FILE }],
      addedLinks: [{ url: "https://example.com", label: "Record" }],
      removedIds: [],
      renamed: [],
    });

    expect(WorkspaceService.stageDocumentUpload).toHaveBeenCalledWith(
      TREE_ID,
      FILE,
      "scan.pdf",
    );
    const payload = vi.mocked(WorkspaceService.saveDocument).mock.calls[0][2];
    expect(payload.attached_upload_ids).toEqual(["upload-1"]);
    expect(payload.added_links).toEqual([
      {
        id: expect.any(String),
        url: "https://example.com",
        filename: "Record",
      },
    ]);
    // The save must run only after every file has finished staging.
    const stageOrder = vi.mocked(WorkspaceService.stageDocumentUpload).mock
      .invocationCallOrder[0];
    const saveOrder = vi.mocked(WorkspaceService.saveDocument).mock
      .invocationCallOrder[0];
    expect(stageOrder).toBeLessThan(saveOrder);
  });

  it("propagates a failed save without extra cleanup calls", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.stageDocumentUpload).mockResolvedValue({
      id: "upload-1",
      filename: "scan.pdf",
      mime_type: "application/pdf",
      size: 9,
    });
    vi.mocked(WorkspaceService.saveDocument).mockRejectedValue(
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
    expect(WorkspaceService.removeDocument).not.toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    const created = await useDocumentStore
      .getState()
      .addDocument(INPUT, ["m1"]);
    expect(created).toBeNull();
    expect(WorkspaceService.saveDocument).not.toHaveBeenCalled();
  });

  it("attempts every file and reports all failures without saving when one stage fails", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.stageDocumentUpload).mockImplementation(
      (_treeId, file) => {
        if (file === FILE2) return Promise.reject(new Error("stalled"));
        return Promise.resolve({
          id: `upload-${file.name}`,
          filename: file.name,
          mime_type: "application/pdf",
          size: file.size,
        });
      },
    );
    const onFileProgress = vi.fn();

    await expect(
      useDocumentStore.getState().addDocument(
        INPUT,
        ["m1"],
        {
          addedFiles: [
            { filename: "scan.pdf", file: FILE },
            { filename: "scan2.pdf", file: FILE2 },
            { filename: "scan3.pdf", file: FILE3 },
          ],
          addedLinks: [],
          removedIds: [],
          renamed: [],
        },
        onFileProgress,
      ),
    ).rejects.toMatchObject({
      name: "DocumentUploadError",
      failed: [{ index: 1, filename: "scan2.pdf" }],
    });

    // Every file is attempted, even the ones queued behind the failure.
    expect(WorkspaceService.stageDocumentUpload).toHaveBeenCalledTimes(3);
    // Progress still advances past the failed file instead of freezing.
    expect(onFileProgress).toHaveBeenCalledWith(3, 3);
    // A partial file set is never attached — the save never runs.
    expect(WorkspaceService.saveDocument).not.toHaveBeenCalled();
  });

  it("rejects with the concrete DocumentUploadError instance", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.stageDocumentUpload).mockRejectedValue(
      new Error("network error"),
    );

    let caught: unknown;
    try {
      await useDocumentStore.getState().addDocument(INPUT, ["m1"], {
        addedFiles: [{ filename: "scan.pdf", file: FILE }],
        addedLinks: [],
        removedIds: [],
        renamed: [],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocumentUploadError);
  });
});

describe("useDocumentStore — updateDocument", () => {
  it("sends metadata, members and file ops in one save request", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.saveDocument).mockResolvedValue(DOC_DB);
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([DOC_DB]);

    await useDocumentStore
      .getState()
      .updateDocument("d1", INPUT, ["m1", "m2"], {
        addedFiles: [],
        addedLinks: [],
        removedIds: ["f-old"],
        renamed: [{ id: "f-keep", filename: "renamed.pdf" }],
      });

    expect(WorkspaceService.saveDocument).toHaveBeenCalledWith(
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
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.removeDocument).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([]);

    await useDocumentStore.getState().removeDocument("d1");

    expect(WorkspaceService.removeDocument).toHaveBeenCalledWith(TREE_ID, "d1");
    expect(WorkspaceService.getDocuments).toHaveBeenCalled();
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
