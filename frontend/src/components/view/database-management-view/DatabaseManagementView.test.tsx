import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useTreeStore } from "@/hooks/useTreeStore";
import { Tree } from "@/types/tree";
import { DatabaseManagementView } from "./DatabaseManagementView";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const openRowMenu = () => {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
    button: 0,
  });
};

const setTrees = (trees: Tree[]) => {
  useTreeStore.setState({
    trees,
    virtualViews: [],
    selectedTree: undefined,
    renameTree: vi.fn(),
  });
};

describe("DatabaseManagementView rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides Rename for a viewer-shared tree", () => {
    setTrees([{ id: "tree-1", name: "Viewer Tree", role: "viewer" }]);

    render(<DatabaseManagementView />);
    openRowMenu();

    expect(
      screen.queryByRole("menuitem", { name: "Rename" }),
    ).not.toBeInTheDocument();
  });

  it("offers Rename for an editor-shared tree", () => {
    setTrees([{ id: "tree-1", name: "Editor Tree", role: "editor" }]);

    render(<DatabaseManagementView />);
    openRowMenu();

    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
  });

  it("renames an owned tree and shows a success toast", async () => {
    const renameTree = vi.fn().mockResolvedValue(undefined);
    setTrees([{ id: "tree-1", name: "My Tree", role: "owner" }]);
    useTreeStore.setState({ renameTree });

    render(<DatabaseManagementView />);
    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByDisplayValue("My Tree");
    fireEvent.change(input, { target: { value: "Renamed Tree" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(renameTree).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tree-1" }),
        "Renamed Tree",
      );
    });
    expect(toast.success).toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Renamed Tree")).not.toBeInTheDocument();
  });

  it("shows an error toast and keeps editing when a rename is rejected", async () => {
    const renameTree = vi.fn().mockRejectedValue(new Error("forbidden"));
    setTrees([{ id: "tree-1", name: "My Tree", role: "owner" }]);
    useTreeStore.setState({ renameTree });

    render(<DatabaseManagementView />);
    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByDisplayValue("My Tree");
    fireEvent.change(input, { target: { value: "Renamed Tree" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Could not rename the tree.");
    });
    // The row stays in edit mode with the attempted name so the user can retry.
    expect(screen.getByDisplayValue("Renamed Tree")).toBeInTheDocument();
  });
});
