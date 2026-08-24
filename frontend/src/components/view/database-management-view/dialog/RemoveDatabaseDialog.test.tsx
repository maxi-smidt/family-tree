import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { type Workspace } from "@/types/workspace";
import { toast } from "sonner";
import { RemoveDatabaseDialog } from "./RemoveDatabaseDialog";

const removeDatabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWorkspaceManager", () => ({
  useWorkspaceManager: () => ({
    removeDatabase: removeDatabaseMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const TREE_A: Workspace = { id: "tree-a", name: "Workspace A", role: "owner" };
const realLoadTrees = useWorkspaceStore.getState().loadTrees;

describe("RemoveDatabaseDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      workspaces: [TREE_A],
      virtualViews: [],
      selectedTree: TREE_A,
      metadata: {},
      relationTypes: [],
      isReady: true,
      loadTrees: realLoadTrees,
    });
  });

  it("shows a permission toast and reloads workspaces when deletion is denied", async () => {
    const loadTrees = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn();
    removeDatabaseMock.mockRejectedValueOnce(
      new ApiError(403, "No access to this tree"),
    );
    useWorkspaceStore.setState({ loadTrees });

    render(
      <RemoveDatabaseDialog
        isOpen
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: TREE_A.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "You no longer have permission to delete this tree.",
      );
    });
    expect(removeDatabaseMock).toHaveBeenCalledWith(TREE_A);
    expect(loadTrees).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });
});
