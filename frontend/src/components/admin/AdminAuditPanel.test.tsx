import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { AdminAuditEntry, AdminService } from "@/services/AdminService";
import { AdminAuditPanel } from "./AdminAuditPanel";

vi.mock("@/services/AdminService");

function makeEntry(id: string, over: Partial<AdminAuditEntry> = {}): AdminAuditEntry {
  return {
    id,
    actor_id: "u1",
    actor_username: "root",
    action: "update",
    subject_type: "user",
    subject_id: "s1",
    subject_label: `Subject ${id}`,
    details: null,
    created_at: "2026-01-01T00:00:00+00:00",
    ...over,
  };
}

describe("AdminAuditPanel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
    vi.mocked(AdminService.listAuditSubjectTypes).mockResolvedValue([
      "user",
      "backup",
    ]);
    vi.mocked(AdminService.listAuditLog).mockResolvedValue({
      items: [makeEntry("1"), makeEntry("2")],
      total: 120,
      limit: 50,
      offset: 0,
    });
  });

  it("shows the total and pages through results", async () => {
    render(<AdminAuditPanel />);

    await waitFor(() =>
      expect(screen.getByText(/Showing 1.50 of 120/)).toBeInTheDocument(),
    );
    expect(AdminService.listAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(AdminService.listAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 50 }),
      ),
    );
  });

  it("filters by actor (debounced) and resets to the first page", async () => {
    render(<AdminAuditPanel />);
    await waitFor(() => expect(AdminService.listAuditLog).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("Username…"), {
      target: { value: "alice" },
    });

    await waitFor(() =>
      expect(AdminService.listAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ actor: "alice", offset: 0 }),
      ),
    );
  });

  it("exports the current view as CSV", async () => {
    vi.mocked(AdminService.exportAuditLog).mockResolvedValue(
      new Blob(["csv"], { type: "text/csv" }),
    );
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<AdminAuditPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(AdminService.exportAuditLog).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
  });

  it("shows a filtered-empty message when no rows match", async () => {
    vi.mocked(AdminService.listAuditLog).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    render(<AdminAuditPanel />);

    fireEvent.change(screen.getByPlaceholderText("Username…"), {
      target: { value: "nobody" },
    });

    await waitFor(() =>
      expect(
        screen.getByText("No audit entries match these filters."),
      ).toBeInTheDocument(),
    );
  });
});
