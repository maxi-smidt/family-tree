import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentUploadError, useDocumentStore } from "./useDocumentStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { useMemberStore } from "@/hooks/useMemberStore";
import { DocumentDB, mapDocumentFromDB } from "@/types/document";
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

it("keeps the captured origin when the selected section changes during an upload", async () => {
  useWorkspaceStore.setState({ selectedTree: TREE });
  useMemberStore.setState({ focusSectionIds: ["private-section"] });
  vi.mocked(WorkspaceService.stageDocumentUpload).mockImplementation(
    async () => {
      useMemberStore.setState({ focusSectionIds: ["other-section"] });
      return {
        id: "upload",
        filename: "scan.pdf",
        mime_type: "application/pdf",
        size: 4,
      };
    },
  );
  vi.mocked(WorkspaceService.saveDocument).mockResolvedValue(DOC_DB);
  vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([DOC_DB]);
  await useDocumentStore.getState().addDocument(INPUT, ["m1"], {
    addedFiles: [{ filename: "scan.pdf", file: FILE }],
    addedLinks: [],
    removedIds: [],
    renamed: [],
  });
  expect(WorkspaceService.stageDocumentUpload).toHaveBeenCalledWith(
    TREE_ID,
    FILE,
    "scan.pdf",
    "private-section",
  );
  expect(WorkspaceService.saveDocument).toHaveBeenCalledWith(
    TREE_ID,
    expect.any(String),
    expect.any(Object),
    "private-section",
  );
  useMemberStore.getState().clear();
});

describe("useDocumentStore — file text", () => {
  const TEXT_DB = {
    document_file_id: "f1",
    language: "de",
    markdown: "Lieber Hans,",
    source: "manual" as const,
    edited_by: "u1",
    edited_at: "2024-01-02T00:00:00Z",
    created_at: "2024-01-02T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  };
  const WITH_FILE: DocumentDB = {
    ...DOC_DB,
    files: [
      {
        id: "f1",
        kind: "file",
        filename: "letter.png",
        url: "/api/media/tree-doc/letter.png",
        mime_type: "image/png",
        size: 10,
        created_at: "2024-01-01T00:00:00Z",
        has_text: false,
      },
    ],
  };

  it("loads a file's text on demand", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getDocumentFileText).mockResolvedValue(TEXT_DB);

    const text = await useDocumentStore.getState().loadFileText("d1", "f1");

    expect(WorkspaceService.getDocumentFileText).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      "f1",
    );
    expect(text?.markdown).toBe("Lieber Hans,");
    expect(text?.fileId).toBe("f1");
  });

  it("returns null when the file has no text", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getDocumentFileText).mockResolvedValue(null);

    expect(await useDocumentStore.getState().loadFileText("d1", "f1")).toBe(
      null,
    );
  });

  it("saving flips the file's has-text flag without refetching", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([WITH_FILE]);
    await useDocumentStore.getState().refreshDocuments();
    vi.mocked(WorkspaceService.saveDocumentFileText).mockResolvedValue(TEXT_DB);

    await useDocumentStore.getState().saveFileText("d1", "f1", "Lieber Hans,");

    expect(WorkspaceService.saveDocumentFileText).toHaveBeenCalledWith(
      TREE_ID,
      "d1",
      "f1",
      "Lieber Hans,",
    );
    expect(WorkspaceService.getDocuments).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().documents[0].files[0].hasText).toBe(
      true,
    );

    vi.mocked(WorkspaceService.saveDocumentFileText).mockResolvedValue(null);
    await useDocumentStore.getState().saveFileText("d1", "f1", "");
    expect(useDocumentStore.getState().documents[0].files[0].hasText).toBe(
      false,
    );
  });
});

describe("useDocumentStore — transcription state", () => {
  const file = {
    id: "f1",
    kind: "file" as const,
    filename: "letter.png",
    url: "/api/media/tree-doc/letter.png",
    mime_type: "image/png",
    size: 10,
    created_at: "2024-01-01T00:00:00Z",
    has_text: false,
    transcription_status: null,
    transcription_error: null,
  };
  const document: DocumentDB = { ...DOC_DB, files: [file] };
  const completed: DocumentDB = {
    ...document,
    files: [{ ...file, has_text: true, transcription_status: "done" }],
  };

  beforeEach(() => {
    useDocumentStore.getState().clear();
    useWorkspaceStore.setState({ selectedTree: TREE });
    useDocumentStore.setState({
      documents: [mapDocumentFromDB(document)],
      initialized: true,
    });
  });

  it.each(["done", "failed"] as const)(
    "keeps the %s event state when completion arrives before the start request resolves",
    async (status) => {
      let acknowledge!: (response: { status: string }) => void;
      vi.mocked(WorkspaceService.transcribeDocumentFile).mockReturnValue(
        new Promise<{ status: string }>((resolve) => {
          acknowledge = resolve;
        }),
      );

      const request = useDocumentStore.getState().transcribeFile("d1", "f1");
      expect(
        useDocumentStore.getState().documents[0].files[0].transcriptionStatus,
      ).toBe("pending");

      vi.mocked(WorkspaceService.getDocuments).mockResolvedValue([
        {
          ...document,
          files: [
            {
              ...file,
              has_text: status === "done",
              transcription_status: status,
              transcription_error:
                status === "failed" ? "provider_error" : null,
            },
          ],
        },
      ]);
      await useDocumentStore.getState().refreshDocuments();
      acknowledge({ status: "pending" });
      await request;

      expect(useDocumentStore.getState().documents[0].files[0]).toMatchObject({
        transcriptionStatus: status,
        hasText: status === "done",
      });
    },
  );

  it("discards an older pending list response after a completed refresh", async () => {
    let resolvePending!: (rows: DocumentDB[]) => void;
    vi.mocked(WorkspaceService.getDocuments)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
      )
      .mockResolvedValueOnce([completed]);

    const older = useDocumentStore.getState().refreshDocuments();
    await useDocumentStore.getState().refreshDocuments();
    resolvePending([
      {
        ...document,
        files: [{ ...file, transcription_status: "pending" }],
      },
    ]);
    await older;

    expect(useDocumentStore.getState().documents[0].files[0]).toMatchObject({
      transcriptionStatus: "done",
      hasText: true,
    });
  });

  it("restores the previous status when starting the transcription fails", async () => {
    useDocumentStore.setState({ documents: [mapDocumentFromDB(completed)] });
    vi.mocked(WorkspaceService.transcribeDocumentFile).mockRejectedValueOnce(
      new Error("network error"),
    );

    await expect(
      useDocumentStore.getState().transcribeFile("d1", "f1"),
    ).rejects.toThrow("network error");

    expect(useDocumentStore.getState().documents[0].files[0]).toMatchObject({
      transcriptionStatus: "done",
      hasText: true,
    });
  });

  it("does not restore old state over a completion when the request fails", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(WorkspaceService.transcribeDocumentFile).mockReturnValueOnce(
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      }),
    );
    const request = useDocumentStore.getState().transcribeFile("d1", "f1");
    vi.mocked(WorkspaceService.getDocuments).mockResolvedValueOnce([completed]);
    await useDocumentStore.getState().refreshDocuments();
    reject(new Error("connection lost"));
    await expect(request).rejects.toThrow("connection lost");

    expect(
      useDocumentStore.getState().documents[0].files[0].transcriptionStatus,
    ).toBe("done");
  });

  it("does not restore a failed request's status into another workspace", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(WorkspaceService.transcribeDocumentFile).mockReturnValueOnce(
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      }),
    );
    const request = useDocumentStore.getState().transcribeFile("d1", "f1");
    useWorkspaceStore.setState({
      selectedTree: { ...TREE, id: "other-tree" },
    });
    useDocumentStore.setState({ documents: [mapDocumentFromDB(completed)] });
    reject(new Error("connection lost"));
    await expect(request).rejects.toThrow("connection lost");

    expect(
      useDocumentStore.getState().documents[0].files[0].transcriptionStatus,
    ).toBe("done");
  });
});
