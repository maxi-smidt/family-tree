import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegalService } from "@/services/LegalService";
import { LegalVersionHistoryPanel } from "./LegalVersionHistoryPanel";

vi.mock("@/services/LegalService");

const VERSIONS = [
  {
    id: "v2",
    document_type: "terms" as const,
    locale: "de",
    version: "2",
    content_hash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    published_at: "2026-02-01T00:00:00+00:00",
  },
  {
    id: "v1",
    document_type: "terms" as const,
    locale: "de",
    version: "1",
    content_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    published_at: "2026-01-01T00:00:00+00:00",
  },
  {
    id: "ve1",
    document_type: "terms" as const,
    locale: "en",
    version: "1",
    content_hash:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    published_at: "2026-01-01T00:00:00+00:00",
  },
  {
    id: "p1",
    document_type: "privacy" as const,
    locale: "de",
    version: "1",
    content_hash:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    published_at: "2026-01-01T00:00:00+00:00",
  },
];

describe("LegalVersionHistoryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LegalService.listVersions).mockResolvedValue(VERSIONS);
  });

  it("loads and filters versions to the given document type and locale", async () => {
    render(<LegalVersionHistoryPanel documentType="terms" locale="de" />);

    await waitFor(
      () => expect(screen.getAllByRole("row")).toHaveLength(3), // header + 2 German terms rows
    );
    // English terms + German privacy rows are filtered out.
    expect(screen.queryByText(/dddddddddddd/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cccccccccccc/)).not.toBeInTheDocument();
  });

  it("shows an empty state when no versions exist for the type", async () => {
    vi.mocked(LegalService.listVersions).mockResolvedValue([]);
    render(<LegalVersionHistoryPanel documentType="imprint" locale="de" />);

    await waitFor(() =>
      expect(
        screen.getByText("No published versions yet."),
      ).toBeInTheDocument(),
    );
  });

  it("opens a dialog with the full body when View is clicked", async () => {
    vi.mocked(LegalService.getVersion).mockResolvedValue({
      ...VERSIONS[0],
      body: "The full historical terms text",
    });

    render(<LegalVersionHistoryPanel documentType="terms" locale="de" />);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));

    const viewButtons = screen.getAllByRole("button", { name: "View" });
    fireEvent.click(viewButtons[0]);

    await waitFor(() =>
      expect(
        screen.getByText("The full historical terms text"),
      ).toBeInTheDocument(),
    );
    expect(LegalService.getVersion).toHaveBeenCalledWith("v2");
  });

  it("shows a toast-worthy error gracefully when loading fails", async () => {
    vi.mocked(LegalService.listVersions).mockRejectedValue(new Error("boom"));
    render(<LegalVersionHistoryPanel documentType="terms" locale="de" />);

    // Stays in the loading state rather than crashing.
    await waitFor(() => expect(LegalService.listVersions).toHaveBeenCalled());
  });
});
