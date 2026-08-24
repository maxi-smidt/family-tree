import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Workspace } from "@/types/workspace";
import { DatabaseSelector } from "./DatabaseSelector";

let workspaces: Workspace[] = [];
let virtualViews: Workspace[] = [];

vi.mock("@/hooks/useWorkspaceStore", () => ({
  useWorkspaceStore: <T,>(
    selector: (state: {
      workspaces: Workspace[];
      virtualViews: Workspace[];
      selectedTree: Workspace | null;
      selectTree: () => Promise<void>;
    }) => T,
  ) =>
    selector({
      workspaces,
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

const OWNED_TREE: Workspace = { id: "tree-1", name: "My Workspace", role: "owner" };
const SHARED_TREE: Workspace = { id: "tree-2", name: "Shared Workspace", role: "editor" };
const VIEW: Workspace = {
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
    workspaces = [];
    virtualViews = [];
  });

  it("shows separate groups for owned and shared workspaces", () => {
    workspaces = [OWNED_TREE, SHARED_TREE];
    renderOpen();

    expect(screen.getByText("Your workspaces")).toBeInTheDocument();
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.getByText("Shared Workspace")).toBeInTheDocument();
  });

  it("hides the shared-workspaces group when there are no shared workspaces", () => {
    workspaces = [OWNED_TREE];
    renderOpen();

    expect(screen.getByText("Your workspaces")).toBeInTheDocument();
    expect(screen.queryByText("Shared with you")).not.toBeInTheDocument();
  });

  it("hides the owned-workspaces group when there are no owned workspaces", () => {
    workspaces = [SHARED_TREE];
    renderOpen();

    expect(screen.queryByText("Your workspaces")).not.toBeInTheDocument();
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
  });

  it("still shows the virtual views group alongside both tree groups", () => {
    workspaces = [OWNED_TREE, SHARED_TREE];
    virtualViews = [VIEW];
    renderOpen();

    expect(screen.getByText("Your workspaces")).toBeInTheDocument();
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.getByText("Virtual Views")).toBeInTheDocument();
    expect(screen.getByText("My View")).toBeInTheDocument();
  });
});
