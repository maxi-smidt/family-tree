import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { fireEvent, renderWithProviders, screen, within } from "@/test/utils";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { ApiError } from "@/services/api";
import { Activity } from "@/types/activity";
import { ActivityView } from "./ActivityView";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const DELETE_ENTRY: Activity = {
  id: "a1",
  treeId: "tree-1",
  actorId: "u1",
  actorUsername: "alice",
  action: "delete",
  targetType: "member",
  targetId: "m1",
  targetLabel: "Ada Doe",
  createdAt: "2026-01-01T00:00:00Z",
  details: { snapshot: { version: 1 } },
};

function setActivityState(
  overrides: Partial<ReturnType<typeof useActivityStore.getState>> = {},
) {
  useActivityStore.setState({
    activities: [DELETE_ENTRY],
    actors: ["alice"],
    total: 1,
    page: 0,
    pageSize: 25,
    filterActor: "",
    filterAction: "",
    filterTargetType: "",
    initialized: true,
    loading: false,
    error: null,
    undo: vi.fn(),
    ...overrides,
  });
}

describe("ActivityView undo", () => {
  beforeEach(() => {
    useTreeStore.setState({
      selectedTree: { id: "tree-1", role: "owner" } as never,
    });
    setActivityState();
  });

  it("shows an undo button for an undoable delete when enabled for an editor", () => {
    renderWithProviders(<ActivityView />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("hides the undo button for a viewer", () => {
    useTreeStore.setState({
      selectedTree: { id: "tree-1", role: "viewer" } as never,
    });
    renderWithProviders(<ActivityView />);
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  });

  it("hides the undo button for an entry without a restorable snapshot", () => {
    setActivityState({
      activities: [{ ...DELETE_ENTRY, details: null }],
    });
    renderWithProviders(<ActivityView />);
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  });

  it("confirms before undoing, then reports success", async () => {
    const undo = vi.fn().mockResolvedValue({
      undo_entry_id: "u1",
      target_type: "member",
      restored: { member: "m1" },
      skipped: [],
    });
    setActivityState({ undo });

    renderWithProviders(<ActivityView />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));

    await vi.waitFor(() => expect(undo).toHaveBeenCalledWith("a1"));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("reports a partial restore as a warning toast", async () => {
    const undo = vi.fn().mockResolvedValue({
      undo_entry_id: "u1",
      target_type: "member",
      restored: { member: "m1" },
      skipped: [{ table: "relations", reason: "member m2 no longer exists" }],
    });
    setActivityState({ undo });

    renderWithProviders(<ActivityView />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Undo",
      }),
    );

    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalled());
  });

  it("reports a conflict as an error toast", async () => {
    const undo = vi.fn().mockRejectedValue(new ApiError(409, "conflict"));
    setActivityState({ undo });

    renderWithProviders(<ActivityView />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Undo",
      }),
    );

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
