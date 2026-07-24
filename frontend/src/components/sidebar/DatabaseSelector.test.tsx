import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Tree } from "@/types/tree";
import { DatabaseSelector } from "./DatabaseSelector";

let trees: Tree[] = [];
let virtualViews: Tree[] = [];

vi.mock("@/hooks/useTreeStore", () => ({
  useTreeStore: <T,>(
    selector: (state: {
      trees: Tree[];
      virtualViews: Tree[];
      selectedTree: Tree | null;
      selectTree: () => Promise<void>;
    }) => T,
  ) =>
    selector({
      trees,
      virtualViews,
      selectedTree: null,
      selectTree: vi.fn(),
    }),
}));

vi.mock("@/hooks/useUnsavedChangesStore", () => ({
  useUnsavedChangesStore: <T,>(
    selector: (state: { guardNavigate: (action: () => void) => void }) => T,
  ) => selector({ guardNavigate: (action) => action() }),
}));

const OWNED_TREE: Tree = { id: "tree-1", name: "My Tree", role: "owner" };
const SHARED_TREE: Tree = { id: "tree-2", name: "Shared Tree", role: "editor" };
const VIEW: Tree = {
  id: "view-1",
  name: "My View",
  role: "owner",
  is_virtual: true,
};

const renderOpen = () => {
  render(<DatabaseSelector />);
  fireEvent.click(screen.getByTestId("tree-selector"));
};

describe("DatabaseSelector", () => {
  beforeEach(() => {
    trees = [];
    virtualViews = [];
  });

  it("shows separate groups for owned and shared trees", () => {
    trees = [OWNED_TREE, SHARED_TREE];
    renderOpen();

    expect(screen.getByText("Your trees")).toBeInTheDocument();
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.getByText("My Tree")).toBeInTheDocument();
    expect(screen.getByText("Shared Tree")).toBeInTheDocument();
  });

  it("hides the shared-trees group when there are no shared trees", () => {
    trees = [OWNED_TREE];
    renderOpen();

    expect(screen.getByText("Your trees")).toBeInTheDocument();
    expect(screen.queryByText("Shared with you")).not.toBeInTheDocument();
  });

  it("hides the owned-trees group when there are no owned trees", () => {
    trees = [SHARED_TREE];
    renderOpen();

    expect(screen.queryByText("Your trees")).not.toBeInTheDocument();
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
  });

  it("still shows the virtual views group alongside both tree groups", () => {
    trees = [OWNED_TREE, SHARED_TREE];
    virtualViews = [VIEW];
    renderOpen();

    expect(screen.getByText("Your trees")).toBeInTheDocument();
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.getByText("Virtual Views")).toBeInTheDocument();
    expect(screen.getByText("My View")).toBeInTheDocument();
  });
});
