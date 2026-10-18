import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSectionStore } from "@/hooks/useSectionStore";
import { SectionDB, SectionDependentsDB } from "@/types/section";
import { DeleteSectionDialog } from "./DeleteSectionDialog";

const SECTION: SectionDB = {
  id: "s1",
  workspace_id: "tree-1",
  name: "Vienna branch",
  position: 0,
  created_at: "2024-01-01T00:00:00Z",
  member_count: 3,
  can_write: true,
};

const CLEAR_DEPENDENTS: SectionDependentsDB = {
  section_id: "s1",
  member_count: 3,
  content_scope_counts: {},
  grant_count: 0,
  invitation_count: 0,
  public_link_count: 0,
};

function setStore(overrides: {
  getSectionDependents: () => Promise<SectionDependentsDB>;
  deleteSection?: () => Promise<void>;
}) {
  useSectionStore.setState({
    getSectionDependents: overrides.getSectionDependents,
    deleteSection: overrides.deleteSection ?? vi.fn().mockResolvedValue(undefined),
  });
}

describe("DeleteSectionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the delete action disabled until the dependents check resolves clear", async () => {
    let resolveDependents: (value: SectionDependentsDB) => void = () => {};
    setStore({
      getSectionDependents: () =>
        new Promise((resolve) => {
          resolveDependents = resolve;
        }),
    });

    render(
      <DeleteSectionDialog section={SECTION} onOpenChange={vi.fn()} />,
    );

    // Still loading: no confirm action offered at all.
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();

    resolveDependents(CLEAR_DEPENDENTS);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Delete" }),
      ).toBeInTheDocument(),
    );
  });

  it("never enables delete when the dependents check fails", async () => {
    setStore({
      getSectionDependents: () => Promise.reject(new Error("network error")),
    });

    render(
      <DeleteSectionDialog section={SECTION} onOpenChange={vi.fn()} />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Could not check what this section holds."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("stays open and shows the error when the delete request fails", async () => {
    const onOpenChange = vi.fn();
    const deleteSection = vi.fn().mockRejectedValue(new Error("boom"));
    setStore({
      getSectionDependents: () => Promise.resolve(CLEAR_DEPENDENTS),
      deleteSection,
    });

    render(
      <DeleteSectionDialog section={SECTION} onOpenChange={onOpenChange} />,
    );

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(
        screen.getByText("The section could not be deleted."),
      ).toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // The dialog is still open and offers the action again.
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("closes only after a successful delete", async () => {
    const onOpenChange = vi.fn();
    const deleteSection = vi.fn().mockResolvedValue(undefined);
    setStore({
      getSectionDependents: () => Promise.resolve(CLEAR_DEPENDENTS),
      deleteSection,
    });

    render(
      <DeleteSectionDialog section={SECTION} onOpenChange={onOpenChange} />,
    );

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(deleteSection).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
