import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  DocumentUploadError,
  useDocumentStore,
} from "@/hooks/useDocumentStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import type { Document, DocumentFile } from "@/types/document";
import { DocumentDialog } from "./DocumentDialog";
import { DocumentImageCropDialog } from "./DocumentImageCropDialog";
import { cropDocumentImage } from "@/utils/documentImageCrop";

vi.mock("@/utils/documentImageCrop", () => ({ cropDocumentImage: vi.fn() }));

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
  beforeEach(() => {
    vi.clearAllMocks();
    useMemberStore.setState({ members: [] });
    useDocumentStore.setState({
      addDocument: vi.fn(),
      updateDocument: vi.fn(),
      fetchMatriculaImage: vi.fn(),
    });
    useUnsavedChangesStore.setState({
      guards: {},
      pendingNav: null,
      dialogOpen: false,
    });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:test-scan"),
        revokeObjectURL: vi.fn(),
      }),
    );
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

  const matriculaUrl =
    "https://data.matricula-online.eu/en/oesterreich/wien/book/?pg=13";

  const savedLink = (overrides: Partial<DocumentFile> = {}): DocumentFile => ({
    id: "source-link",
    kind: "link",
    filename: null,
    url: matriculaUrl,
    mimeType: null,
    size: null,
    createdAt: "2026-01-01T00:00:00Z",
    hasText: false,
    transcriptionStatus: null,
    transcriptionError: null,
    ...overrides,
  });

  const enterLink = (url = matriculaUrl) => {
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: url },
    });
  };

  it.each([
    {
      name: "an image",
      extra: savedLink({
        id: "image",
        kind: "file",
        filename: "scan.jpg",
        url: "",
        mimeType: "image/jpeg",
      }),
    },
    {
      name: "a PDF",
      extra: savedLink({
        id: "pdf",
        kind: "file",
        filename: "scan.pdf",
        url: "",
        mimeType: "application/pdf",
      }),
    },
  ])("hides importing when the document contains $name", ({ extra }) => {
    render(
      <DocumentDialog
        open
        onOpenChange={vi.fn()}
        document={{
          ...UNLINKED_DOCUMENT,
          files: [savedLink(), extra],
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Fetch image and crop" }),
    ).not.toBeInTheDocument();
  });

  it("counts both unsaved links and the current link draft", () => {
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    enterLink();
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(
      screen.getAllByRole("button", { name: "Fetch image and crop" }),
    ).toHaveLength(1);
    enterLink(matriculaUrl.replace("pg=13", "pg=14"));
    expect(
      screen.getAllByRole("button", { name: "Fetch image and crop" }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.com/other-source" },
    });
    expect(
      screen.getAllByRole("button", { name: "Fetch image and crop" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("combobox", { name: "Matricula source" }),
    ).not.toBeInTheDocument();
  });

  it("lets the user fetch from any of multiple saved Matricula links", async () => {
    const fetchImage = vi
      .fn()
      .mockResolvedValue(
        new File(["scan"], "scan.jpg", { type: "image/jpeg" }),
      );
    useDocumentStore.setState({ fetchMatriculaImage: fetchImage });
    const secondUrl = matriculaUrl.replace("pg=13", "pg=14");
    render(
      <DocumentDialog
        open
        onOpenChange={vi.fn()}
        document={{
          ...UNLINKED_DOCUMENT,
          files: [
            savedLink(),
            savedLink({ id: "second-link", url: secondUrl }),
          ],
        }}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Matricula source" }),
      {
        target: { value: "second-link" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    );
    await screen.findByRole("dialog", { name: "Crop document image" });
    expect(fetchImage).toHaveBeenCalledWith(secondUrl, expect.any(AbortSignal));
  });

  it("hides importing immediately after selecting a file and restores it on removal", () => {
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    enterLink();
    const input = document.body.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["pdf"], "scan.pdf", { type: "application/pdf" })],
      },
    });
    expect(
      screen.queryByRole("button", { name: "Fetch image and crop" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    ).toBeInTheDocument();
  });

  it("shows one import prompt when there is also a non-Matricula link", () => {
    render(
      <DocumentDialog
        open
        onOpenChange={vi.fn()}
        document={{
          ...UNLINKED_DOCUMENT,
          files: [
            savedLink(),
            savedLink({ id: "other", url: "https://example.com/" }),
          ],
        }}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: "Fetch image and crop" }),
    ).toHaveLength(1);
  });

  it.each([null, "Baptism register"])(
    "shows the saved URL when editing a link labelled %s",
    async (filename) => {
      const updateDocument = vi.fn().mockResolvedValue(undefined);
      useDocumentStore.setState({ updateDocument });
      render(
        <DocumentDialog
          open
          onOpenChange={vi.fn()}
          document={{
            ...UNLINKED_DOCUMENT,
            files: [savedLink({ filename })],
          }}
        />,
      );
      expect(screen.getByRole("link", { name: matriculaUrl })).toHaveAttribute(
        "href",
        matriculaUrl,
      );
      expect(
        screen.getByRole("textbox", { name: "Label (optional)" }),
      ).toHaveValue(filename ?? "");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(updateDocument).toHaveBeenCalledWith(
          "document-1",
          expect.anything(),
          [],
          { addedFiles: [], addedLinks: [], removedIds: [], renamed: [] },
          expect.any(Function),
        ),
      );
    },
  );

  it("offers importing only Matricula links, without fetching before consent", () => {
    const fetchImage = vi.fn();
    useDocumentStore.setState({ fetchMatriculaImage: fetchImage });
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    enterLink("https://example.com/matricula-online.eu");
    expect(
      screen.queryByRole("button", { name: "Fetch image and crop" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: matriculaUrl },
    });
    expect(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    ).toBeEnabled();
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("fetches the scan, opens the editor, and saves its crop and source in the same document", async () => {
    const scan = new File(["scan"], "matricula-page-13.jpg", {
      type: "image/jpeg",
    });
    const cropped = new File(["crop"], "matricula-page-13-crop.jpg", {
      type: "image/jpeg",
    });
    const fetchImage = vi.fn().mockResolvedValue(scan);
    const addDocument = vi.fn().mockResolvedValue({ id: "created-document" });
    useDocumentStore.setState({ fetchMatriculaImage: fetchImage, addDocument });
    vi.mocked(cropDocumentImage).mockResolvedValue(cropped);
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    enterLink();
    fireEvent.change(screen.getByPlaceholderText("Label (optional)"), {
      target: { value: "Baptism register" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    );
    const editor = await screen.findByRole("dialog", {
      name: "Crop document image",
    });
    expect(fetchImage).toHaveBeenCalledWith(
      matriculaUrl,
      expect.any(AbortSignal),
    );
    expect(addDocument).not.toHaveBeenCalled();
    fireEvent.load(within(editor).getByAltText("Document image to crop"));
    fireEvent.wheel(within(editor).getByAltText("Document image to crop"), {
      ctrlKey: true,
      deltaY: -Math.log(2) * 100,
    });
    expect(within(editor).getByText("200%")).toBeInTheDocument();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Attach image" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Crop document image" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue(cropped.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Baptism register")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Fetch image and crop" }),
    ).not.toBeInTheDocument();
    expect(addDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(addDocument).toHaveBeenCalledWith(
        expect.objectContaining({ title: "matricula-page-13-crop" }),
        [],
        expect.objectContaining({
          addedFiles: [{ filename: cropped.name, file: cropped }],
          addedLinks: [{ url: matriculaUrl, label: "Baptism register" }],
        }),
        expect.any(Function),
      ),
    );
  });

  it("keeps the link draft when cropping is canceled", async () => {
    useDocumentStore.setState({
      fetchMatriculaImage: vi
        .fn()
        .mockResolvedValue(
          new File(["scan"], "scan.jpg", { type: "image/jpeg" }),
        ),
    });
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    enterLink();
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    );
    const editor = await screen.findByRole("dialog", {
      name: "Crop document image",
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(screen.getByPlaceholderText("https://...")).toHaveValue(
      matriculaUrl,
    );
    expect(screen.queryByDisplayValue("scan-crop.jpg")).not.toBeInTheDocument();
  });

  it("offers a local scan fallback on fetch failure and still allows adding the link", async () => {
    useDocumentStore.setState({
      fetchMatriculaImage: vi.fn().mockRejectedValue(new Error("Unavailable")),
    });
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    enterLink();
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    );
    await screen.findByRole("alert");
    expect(
      screen.getByRole("link", { name: "Open Matricula" }),
    ).toHaveAttribute("href", matriculaUrl);
    expect(
      screen.getByRole("button", { name: "Choose scan to crop" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(
      screen.getByRole("link", { name: matriculaUrl }),
    ).toBeInTheDocument();
  });

  it("ignores a late fetch result after the URL changes", async () => {
    let resolve!: (file: File) => void;
    let signal: AbortSignal | undefined;
    const fetchImage = vi.fn((_url: string, requestSignal?: AbortSignal) => {
      signal = requestSignal;
      return new Promise<File>((done) => {
        resolve = done;
      });
    });
    useDocumentStore.setState({ fetchMatriculaImage: fetchImage });
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    enterLink();
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    );
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.com/" },
    });
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      resolve(new File(["scan"], "scan.jpg", { type: "image/jpeg" })),
    );
    expect(
      screen.queryByRole("dialog", { name: "Crop document image" }),
    ).not.toBeInTheDocument();
  });

  it("attaches a crop to an existing document without duplicating its source link", async () => {
    const cropped = new File(["crop"], "page-crop.jpg", { type: "image/jpeg" });
    const updateDocument = vi.fn().mockResolvedValue(undefined);
    useDocumentStore.setState({
      updateDocument,
      fetchMatriculaImage: vi
        .fn()
        .mockResolvedValue(
          new File(["scan"], "page.jpg", { type: "image/jpeg" }),
        ),
    });
    vi.mocked(cropDocumentImage).mockResolvedValue(cropped);
    render(
      <DocumentDialog
        open
        onOpenChange={vi.fn()}
        document={{
          ...UNLINKED_DOCUMENT,
          files: [
            {
              id: "source-link",
              kind: "link",
              filename: "Matricula",
              url: matriculaUrl,
              mimeType: null,
              size: null,
              createdAt: "2026-01-01T00:00:00Z",
              hasText: false,
              transcriptionStatus: null,
              transcriptionError: null,
            },
          ],
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    );
    const editor = await screen.findByRole("dialog", {
      name: "Crop document image",
    });
    fireEvent.load(within(editor).getByAltText("Document image to crop"));
    fireEvent.click(
      within(editor).getByRole("button", { name: "Attach image" }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue(cropped.name)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith(
        "document-1",
        expect.objectContaining({ title: "Archive index" }),
        [],
        {
          addedFiles: [{ filename: cropped.name, file: cropped }],
          addedLinks: [],
          removedIds: [],
          renamed: [],
        },
        expect.any(Function),
      ),
    );
  });

  it("lets the user retry a crop that exceeds the attachment size limit", async () => {
    const onConfirm = vi.fn();
    const scan = new File(["scan"], "scan.jpg", { type: "image/jpeg" });
    vi.mocked(cropDocumentImage).mockResolvedValue(
      new File(["too large"], "scan-crop.jpg", { type: "image/jpeg" }),
    );
    render(
      <DocumentImageCropDialog
        image={scan}
        maxFileBytes={4}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.load(screen.getByAltText("Document image to crop"));
    fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("max 4 B");
    expect(onConfirm).not.toHaveBeenCalled();
    const smaller = new File(["ok"], "scan-crop.jpg", { type: "image/jpeg" });
    vi.mocked(cropDocumentImage).mockResolvedValue(smaller);
    fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(smaller));
  });

  it("keeps the source draft unchanged if its cropped file is rejected", async () => {
    const addDocument = vi.fn().mockResolvedValue({ id: "created" });
    useDocumentStore.setState({
      addDocument,
      fetchMatriculaImage: vi
        .fn()
        .mockResolvedValue(
          new File(["scan"], "scan.jpg", { type: "image/jpeg" }),
        ),
    });
    vi.mocked(cropDocumentImage).mockResolvedValue(
      new File(["bad"], "scan.exe", { type: "image/jpeg" }),
    );
    render(<DocumentDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Title *"), {
      target: { value: "Archive index" },
    });
    enterLink();
    fireEvent.click(
      screen.getByRole("button", { name: "Fetch image and crop" }),
    );
    const cropper = await screen.findByRole("dialog", {
      name: "Crop document image",
    });
    fireEvent.load(within(cropper).getByAltText("Document image to crop"));
    fireEvent.click(
      within(cropper).getByRole("button", { name: "Attach image" }),
    );
    expect(await within(cropper).findByRole("alert")).toHaveTextContent(
      "Unsupported file type",
    );
    fireEvent.click(within(cropper).getByRole("button", { name: "Cancel" }));
    expect(screen.getByPlaceholderText("https://...")).toHaveValue(
      matriculaUrl,
    );
    expect(
      screen.queryByRole("link", { name: matriculaUrl }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(addDocument).toHaveBeenCalledWith(
        expect.anything(),
        [],
        expect.objectContaining({ addedFiles: [], addedLinks: [] }),
        expect.any(Function),
      ),
    );
  });
});
