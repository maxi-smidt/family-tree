import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppKeyboardShortcuts } from "./AppKeyboardShortcuts";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useActiveViewStore } from "@/hooks/useActiveViewStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";

vi.mock("@/components/shared/member-sheet/NewPersonSheet", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="New person" data-new-person>
      <input aria-label="Person name" />
      <button onClick={onClose}>Close person</button>
    </div>
  ),
}));

describe("app keyboard shortcuts", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Family", role: "owner" },
      isReady: true,
    });
    useNavigationStore.setState({ pendingView: null });
    useUnsavedChangesStore.setState({
      guards: {},
      pendingNav: null,
      dialogOpen: false,
    });
    useUserSettingsViewStore.setState({ open: false });
    useAdminViewStore.setState({ open: false });
  });

  it.each(["metaKey", "ctrlKey"])(
    "navigates to the tree and opens a person with %s+Enter",
    async (modifier) => {
      useActiveViewStore.setState({ activeView: "media-view" });
      render(
        <>
          <AppKeyboardShortcuts />
          <input aria-label="Image title" defaultValue="Unsaved title" />
        </>,
      );
      fireEvent.keyDown(window, { key: "Enter", [modifier]: true });
      const name = await screen.findByLabelText("Person name");
      expect(useNavigationStore.getState().pendingView).toBe("tree-view");
      fireEvent.change(name, { target: { value: "Anna" } });
      fireEvent.keyDown(name, { key: "Enter", [modifier]: true });
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(name).toHaveValue("Anna");
      fireEvent.click(screen.getByText("Close person"));
      expect(screen.getByLabelText("Image title")).toHaveValue("Unsaved title");
    },
  );

  it.each(["settings", "admin"])(
    "leaves %s for the tree when creating a person",
    async (screen) => {
      if (screen === "settings")
        useUserSettingsViewStore.getState().openSettings();
      else useAdminViewStore.getState().openAdmin();
      render(<AppKeyboardShortcuts />);
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
      expect(useNavigationStore.getState().pendingView).toBe("tree-view");
      expect(useUserSettingsViewStore.getState().open).toBe(false);
      expect(useAdminViewStore.getState().open).toBe(false);
    },
  );

  it("waits for unsaved-change resolution before navigating or opening a person", async () => {
    useUnsavedChangesStore
      .getState()
      .register("draft", { requestSave: vi.fn().mockResolvedValue(true) });
    useActiveViewStore.setState({ activeView: "list-view" });
    render(<AppKeyboardShortcuts />);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(useUnsavedChangesStore.getState().dialogOpen).toBe(true);
    expect(useNavigationStore.getState().pendingView).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => useUnsavedChangesStore.getState().resolveDiscard());
    expect(useNavigationStore.getState().pendingView).toBe("tree-view");
    expect(await screen.findByLabelText("Person name")).toBeInTheDocument();
  });

  it("ignores the old shortcut, plain Enter, and Cmd+Enter while typing or in a dialog", () => {
    render(
      <>
        <AppKeyboardShortcuts />
        <input aria-label="Search" />
      </>,
    );
    expect(fireEvent.keyDown(window, { key: "n" })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "n", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "n", ctrlKey: true })).toBe(true);
    expect(
      fireEvent.keyDown(screen.getByLabelText("Search"), {
        key: "Enter",
        metaKey: true,
      }),
    ).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    render(<div role="dialog">Existing panel</div>);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(
      screen.queryByRole("dialog", { name: "New person" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer creation without write access or a ready workspace", () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Family", role: "viewer" },
    });
    render(<AppKeyboardShortcuts />);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => useWorkspaceStore.setState({ selectedTree: undefined }));
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves only the foreground dialog while typing, and ignores repeated keydown", () => {
    const background = vi.fn();
    const foreground = vi.fn();
    render(
      <>
        <AppKeyboardShortcuts />
        <Button shortcut="save" onClick={background}>
          Save page
        </Button>
        <div role="dialog">
          <input aria-label="Description" />
          <Button shortcut="save" onClick={foreground}>
            Save image
          </Button>
        </div>
      </>,
    );
    const input = screen.getByLabelText("Description");
    expect(fireEvent.keyDown(input, { key: "s", metaKey: true })).toBe(false);
    fireEvent.keyDown(input, { key: "s", metaKey: true, repeat: true });
    expect(foreground).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save image" }).querySelector("kbd"),
    ).toBeInTheDocument();
  });

  it("does not save a background panel through a dialog without a save action", () => {
    const save = vi.fn();
    render(
      <>
        <AppKeyboardShortcuts />
        <Button shortcut="save" onClick={save}>
          Save
        </Button>
        <div role="alertdialog">Confirm deletion</div>
      </>,
    );
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores hidden or disabled saves and chooses the focused form on a page", () => {
    const save = vi.fn();
    const other = vi.fn();
    render(
      <>
        <AppKeyboardShortcuts />
        <div hidden>
          <Button shortcut="save" onClick={other}>
            Hidden save
          </Button>
        </div>
        <form>
          <input aria-label="Profile" />
          <Button type="button" shortcut="save" onClick={save}>
            Save profile
          </Button>
        </form>
        <Button shortcut="save" onClick={other} disabled>
          Save other
        </Button>
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Profile"), {
      key: "s",
      ctrlKey: true,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });

  it("submits an autosaving editor without a save button", () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <>
        <AppKeyboardShortcuts />
        <div role="dialog">
          <form data-save-shortcut onSubmit={submit}>
            <input aria-label="First name" />
          </form>
        </div>
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("First name"), {
      key: "s",
      metaKey: true,
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("disables commands during the blocking legal gate", () => {
    const save = vi.fn();
    render(
      <>
        <AppKeyboardShortcuts enabled={false} />
        <Button shortcut="save" onClick={save}>
          Save
        </Button>
      </>,
    );
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
