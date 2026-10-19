import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "@/test/utils";
import { useAiSettingsStore } from "@/hooks/useAiSettingsStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { AiSettings } from "@/types/ai";
import type { DocumentFile } from "@/types/document";
import { DocumentFileTranscribeButton } from "./DocumentFileTranscribeButton";

const FILE: DocumentFile = {
  id: "file-1",
  kind: "file",
  filename: "brief.jpg",
  url: "/api/media/tree-1/brief.jpg",
  mimeType: "image/jpeg",
  size: 100,
  createdAt: "2026-01-01T00:00:00Z",
  hasText: false,
  transcriptionStatus: null,
  transcriptionError: null,
};

const GEMINI = {
  id: "gemini",
  label: "Google Gemini",
  default_model: "gemini-2.5-pro",
  needs_api_key: true,
  custom_base_url: false,
  supports_pdf: true,
} as const;

const CUSTOM = {
  id: "openai_compatible",
  label: "OpenAI-compatible",
  default_model: "qwen2.5vl",
  needs_api_key: false,
  custom_base_url: true,
  supports_pdf: false,
} as const;

function settings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    configured: true,
    provider: "gemini",
    model: "gemini-2.5-pro",
    base_url: null,
    has_api_key: true,
    api_key_hint: "abcd",
    api_key_unreadable: false,
    providers: [GEMINI, CUSTOM],
    ...overrides,
  };
}

const transcribeFile = vi.fn();
const load = vi.fn();

function renderButton(file: DocumentFile = FILE) {
  return renderWithProviders(
    <DocumentFileTranscribeButton documentId="doc-1" file={file} />,
  );
}

describe("DocumentFileTranscribeButton", () => {
  beforeEach(() => {
    transcribeFile.mockReset().mockResolvedValue(undefined);
    load.mockReset().mockResolvedValue(undefined);
    useDocumentStore.setState({ transcribeFile });
    useAiSettingsStore.setState({ settings: settings(), load });
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
    });
  });

  it("asks for confirmation before sending the file", async () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Transcribe with AI" }));
    expect(
      await screen.findByText(/You do this at your own risk/),
    ).toBeInTheDocument();
    expect(transcribeFile).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Send to Google Gemini" }),
    );
    await waitFor(() =>
      expect(transcribeFile).toHaveBeenCalledWith("doc-1", "file-1"),
    );
  });

  it("stays out of the row once the file has a text", () => {
    renderButton({ ...FILE, hasText: true });
    expect(
      screen.queryByRole("button", { name: "Transcribe with AI" }),
    ).not.toBeInTheDocument();
  });

  it("is hidden while AI is not set up", () => {
    useAiSettingsStore.setState({ settings: settings({ configured: false }) });
    renderButton();
    expect(
      screen.queryByRole("button", { name: "Transcribe with AI" }),
    ).not.toBeInTheDocument();
  });

  it("is hidden for viewers", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "viewer" },
    });
    renderButton();
    expect(
      screen.queryByRole("button", { name: "Transcribe with AI" }),
    ).not.toBeInTheDocument();
  });

  it("offers PDFs only to providers that read them", () => {
    useAiSettingsStore.setState({
      settings: settings({ provider: "openai_compatible" }),
    });
    renderButton({ ...FILE, mimeType: "application/pdf" });
    expect(
      screen.queryByRole("button", { name: "Transcribe with AI" }),
    ).not.toBeInTheDocument();
  });

  it("shows a running transcription as busy", () => {
    renderButton({ ...FILE, transcriptionStatus: "pending" });
    expect(
      screen.getByRole("button", { name: "AI transcription is running…" }),
    ).toBeDisabled();
  });

  it("clears the spinner when text arrives before the start request resolves", async () => {
    const startedToast = vi.spyOn(toast, "info");
    let acknowledge!: () => void;
    transcribeFile.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
    );
    const { rerender } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe with AI" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Send to Google Gemini" }),
    );
    rerender(
      <DocumentFileTranscribeButton
        documentId="doc-1"
        file={{ ...FILE, transcriptionStatus: "pending" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "AI transcription is running…" }),
    ).toBeDisabled();

    rerender(
      <DocumentFileTranscribeButton
        documentId="doc-1"
        file={{ ...FILE, hasText: true, transcriptionStatus: "done" }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "AI transcription is running…" }),
    ).not.toBeInTheDocument();
    await act(async () => acknowledge());
    expect(
      screen.queryByRole("button", { name: "AI transcription is running…" }),
    ).not.toBeInTheDocument();
    expect(startedToast).not.toHaveBeenCalled();
    startedToast.mockRestore();
  });
});
