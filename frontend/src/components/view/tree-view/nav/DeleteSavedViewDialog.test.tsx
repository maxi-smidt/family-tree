import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { SavedViewDB } from "@/types/savedView";
import { DeleteSavedViewDialog } from "./DeleteSavedViewDialog";

const VIEW: SavedViewDB = {
  id: "v1",
  workspace_id: "tree-1",
  owner_id: "u1",
  name: "Vienna branch",
  focus_member_id: "m1",
  section_ids: [],
  ancestor_depth: 3,
  descendant_depth: 3,
  include_partners: true,
  filters: {},
  config_version: 1,
  version: 1,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  last_opened: null,
  positions: [],
};

describe("DeleteSavedViewDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays open and shows the error when the delete request fails", async () => {
    const onOpenChange = vi.fn();
    const deleteSavedView = vi.fn().mockRejectedValue(new Error("boom"));
    useSavedViewStore.setState({ deleteSavedView });

    render(<DeleteSavedViewDialog view={VIEW} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(
        screen.getByText("The saved view could not be deleted."),
      ).toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes and reports the deletion only after it succeeds", async () => {
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    const deleteSavedView = vi.fn().mockResolvedValue(undefined);
    useSavedViewStore.setState({ deleteSavedView });

    render(
      <DeleteSavedViewDialog
        view={VIEW}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteSavedView).toHaveBeenCalledWith("v1"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onDeleted).toHaveBeenCalledWith("v1");
  });
});
