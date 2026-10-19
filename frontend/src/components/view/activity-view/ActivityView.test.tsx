import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { fireEvent, renderWithProviders, screen, within } from "@/test/utils";
import { useActivityStore } from "@/hooks/useActivityStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { ApiError } from "@/services/api";
import { Activity } from "@/types/activity";
import { ActivityView } from "./ActivityView";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const DELETE_ENTRY: Activity = {
  id: "a1",
  workspaceId: "tree-1",
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
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", role: "owner" } as never,
    });
    setActivityState();
  });

  it("shows an undo button for an undoable delete when enabled for an editor", () => {
    renderWithProviders(<ActivityView />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("hides the undo button for a viewer", () => {
    useWorkspaceStore.setState({
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

describe("ActivityView clear history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", role: "owner" } as never,
    });
    setActivityState({ clearActivities: vi.fn().mockResolvedValue(undefined) });
  });

  it.each(["editor", "viewer"])("hides clear activity for %s", (role) => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", role } as never,
    });
    renderWithProviders(<ActivityView />);
    expect(
      screen.queryByRole("button", { name: "Clear activity" }),
    ).not.toBeInTheDocument();
  });

  it("requires confirmation and allows canceling", () => {
    renderWithProviders(<ActivityView />);
    fireEvent.click(screen.getByRole("button", { name: "Clear activity" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("including entries hidden by filters");
    expect(useActivityStore.getState().clearActivities).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(useActivityStore.getState().clearActivities).not.toHaveBeenCalled();
  });

  it("prevents duplicate submissions while clearing and reports success", async () => {
    let resolve!: () => void;
    const clearActivities = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolve = res;
        }),
    );
    setActivityState({ clearActivities });
    renderWithProviders(<ActivityView />);
    fireEvent.click(screen.getByRole("button", { name: "Clear activity" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Clear activity",
    });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(dialog).toBeInTheDocument();
    resolve();
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(clearActivities).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Activity cleared.");
  });

  it("keeps confirmation open after failure so owners can retry", async () => {
    setActivityState({
      clearActivities: vi.fn().mockRejectedValue(new Error("offline")),
    });
    renderWithProviders(<ActivityView />);
    fireEvent.click(screen.getByRole("button", { name: "Clear activity" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Clear activity",
      }),
    );
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not clear activity."),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("renders AI submissions and lets people filter them", () => {
    const setFilter = vi.fn();
    setActivityState({
      setFilter,
      activities: [
        {
          ...DELETE_ENTRY,
          action: "send_to_ai",
          targetType: "document_file",
          targetLabel: "letter.jpg",
          details: null,
        },
      ],
    });
    renderWithProviders(<ActivityView />);
    expect(screen.getByText(/sent to AI: document file/)).toBeInTheDocument();
    expect(screen.getByText("letter.jpg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Sent to AI" }));
    expect(setFilter).toHaveBeenCalledWith("filterAction", "send_to_ai");
  });
});
