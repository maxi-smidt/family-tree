import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewPersonSheet from "./NewPersonSheet";
import { AppKeyboardShortcuts } from "@/components/layout/AppKeyboardShortcuts";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import i18n from "@/i18n/i18n";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

describe("global new-person panel", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", name: "Family", role: "owner" },
      isReady: true,
    });
    useMemberStore.setState({
      members: [],
      addMember: vi.fn().mockResolvedValue(undefined),
    });
    useGalleryStore.setState({ galleryImages: [], initialized: true });
    useMemberSheetStore.setState({
      openSheets: {
        "tree-1": {
          memberId: "background-person",
          tab: "identity",
          mode: "view",
        },
      },
    });
    useUnsavedChangesStore.setState({ guards: {} });
  });

  function fillName() {
    fireEvent.change(
      screen.getByLabelText(i18n.t("sheet.edit-mode.firstname-field")),
      { target: { value: "Anna" } },
    );
    fireEvent.change(
      screen.getByLabelText(i18n.t("sheet.edit-mode.lastname-field")),
      { target: { value: "Smith" } },
    );
  }

  it("creates once with Cmd+S and preserves the background profile's navigation", async () => {
    const onClose = vi.fn();
    render(
      <>
        <AppKeyboardShortcuts />
        <NewPersonSheet onClose={onClose} />
      </>,
    );
    fillName();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "s", metaKey: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "s", metaKey: true });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useMemberStore.getState().addMember).toHaveBeenCalledTimes(1);
    expect(useMemberStore.getState().addMember).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Anna", lastName: "Smith" }),
    );
    expect(useMemberSheetStore.getState().openSheets["tree-1"].memberId).toBe(
      "background-person",
    );
  });

  it("keeps the draft open when creation fails, then allows retry", async () => {
    vi.mocked(useMemberStore.getState().addMember).mockRejectedValueOnce(
      new Error("Offline"),
    );
    const onClose = vi.fn();
    render(
      <>
        <AppKeyboardShortcuts />
        <NewPersonSheet onClose={onClose} />
      </>,
    );
    fillName();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), {
        key: "s",
        ctrlKey: true,
      });
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText(i18n.t("sheet.edit-mode.firstname-field")),
    ).toHaveValue("Anna");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), {
        key: "s",
        ctrlKey: true,
      });
    });
    expect(onClose).toHaveBeenCalled();
    expect(useMemberStore.getState().addMember).toHaveBeenCalledTimes(2);
  });
});
