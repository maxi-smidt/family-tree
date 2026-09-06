import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { ApiError } from "@/services/api";
import { SavedViewDB } from "@/types/savedView";
import { Member } from "@/types/member";
import { SectionDB } from "@/types/section";
import { SavedViewFormDialog } from "./SavedViewFormDialog";

const VIEW: SavedViewDB = {
  id: "v1",
  workspace_id: "tree-1",
  owner_id: "u1",
  name: "Vienna branch",
  focus_member_id: "m1",
  section_ids: ["s1"],
  ancestor_depth: 2,
  descendant_depth: 4,
  include_partners: false,
  filters: {},
  config_version: 1,
  version: 3,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  last_opened: null,
  positions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useMemberStore.setState({
    members: [
      {
        id: "m1",
        firstName: "Otto",
        lastName: "Adams",
        maidenName: null,
        date: { birth: "", death: null },
      } as Member,
    ],
  });
  useSectionStore.setState({
    sections: [
      {
        id: "s1",
        workspace_id: "tree-1",
        name: "Vienna branch",
        position: 0,
        created_at: "2024-01-01T00:00:00Z",
        member_count: 4,
        can_write: true,
      } as SectionDB,
    ],
  });
});

describe("SavedViewFormDialog — create", () => {
  it("creates a view with the entered name", async () => {
    const createSavedView = vi.fn().mockResolvedValue(VIEW);
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    useSavedViewStore.setState({ createSavedView });

    render(
      <SavedViewFormDialog
        open
        view={null}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New view" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createSavedView).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New view" }),
      ),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSaved).toHaveBeenCalledWith(VIEW, true);
  });

  it("disables create until a name is entered", () => {
    render(<SavedViewFormDialog open view={null} onOpenChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});

describe("SavedViewFormDialog — edit", () => {
  it("pre-fills the form from the view and saves with its expected_version", async () => {
    const updateSavedView = vi
      .fn()
      .mockResolvedValue({ ...VIEW, name: "Renamed" });
    const onOpenChange = vi.fn();
    useSavedViewStore.setState({ updateSavedView });

    render(
      <SavedViewFormDialog open view={VIEW} onOpenChange={onOpenChange} />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Vienna branch");

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateSavedView).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({ name: "Renamed", expected_version: 3 }),
      ),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows a stale-conflict message on a 409 and keeps the dialog open", async () => {
    const updateSavedView = vi
      .fn()
      .mockRejectedValue(new ApiError(409, "saved_view_changed_concurrently"));
    const onOpenChange = vi.fn();
    useSavedViewStore.setState({ updateSavedView });

    render(
      <SavedViewFormDialog open view={VIEW} onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "This view changed elsewhere since you opened it. Close and reopen it to see the latest version before saving.",
        ),
      ).toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
