import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { createMember } from "@/types/member";
import { CreateSectionDialog } from "./CreateSectionDialog";

const PREVIEW = {
  primary_member_ids: ["root", "parent", "sibling"],
  boundary_member_ids: ["partner", "child"],
  overlaps: [],
};

describe("CreateSectionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMemberStore.setState({
      members: [
        {
          ...createMember({ x: 0, y: 0 }),
          id: "root",
          firstName: "Anna",
          lastName: "Smith",
        },
      ],
    });
    useSectionStore.setState({
      sections: [],
      previewSection: vi.fn().mockResolvedValue(PREVIEW),
      createSection: vi.fn().mockResolvedValue({ id: "new-section" }),
    });
  });

  it("distinguishes section membership from connected people outside it", async () => {
    render(
      <CreateSectionDialog
        open
        onOpenChange={vi.fn()}
        initialRootMemberId="root"
      />,
    );
    expect(
      await screen.findByText("3 people in this section"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 connected people outside the section"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Include")).toHaveTextContent(
      "Family of origin",
    );
    expect(screen.getByText("Connected, outside section")).toBeInTheDocument();
    expect(useSectionStore.getState().previewSection).toHaveBeenCalledWith(
      "root",
      "direct_family",
    );
    expect(screen.queryByText("5 people total")).not.toBeInTheDocument();
  });

  it("offers three branch options and creates the family of origin", async () => {
    const onOpenChange = vi.fn();
    render(
      <CreateSectionDialog
        open
        onOpenChange={onOpenChange}
        initialRootMemberId="root"
      />,
    );
    fireEvent.click(screen.getByLabelText("Include"));
    expect(
      (await screen.findAllByRole("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      "Extended family and partners",
      "Direct line and partner",
      "Family of origin",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Family of origin" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Origin branch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(useSectionStore.getState().createSection).toHaveBeenCalledWith({
        name: "Origin branch",
        root_member_id: "root",
        direction: "direct_family",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("previews and creates the direct-line-and-partner option", async () => {
    const onOpenChange = vi.fn();
    render(
      <CreateSectionDialog
        open
        onOpenChange={onOpenChange}
        initialRootMemberId="root"
      />,
    );
    fireEvent.click(screen.getByLabelText("Include"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Direct line and partner" }),
    );
    await waitFor(() =>
      expect(
        useSectionStore.getState().previewSection,
      ).toHaveBeenLastCalledWith("root", "lineage"),
    );
    expect(screen.getByLabelText("Include")).toHaveAccessibleDescription(
      "The selected person, all their ancestors and descendants, and their own partners. Siblings, cousins and partners' families stay outside this selection.",
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Direct family" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(useSectionStore.getState().createSection).toHaveBeenCalledWith({
        name: "Direct family",
        root_member_id: "root",
        direction: "lineage",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("previews and creates extended family with partners", async () => {
    const onOpenChange = vi.fn();
    render(
      <CreateSectionDialog
        open
        onOpenChange={onOpenChange}
        initialRootMemberId="root"
      />,
    );
    fireEvent.click(screen.getByLabelText("Include"));
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Extended family and partners",
      }),
    );
    await waitFor(() =>
      expect(
        useSectionStore.getState().previewSection,
      ).toHaveBeenLastCalledWith("root", "extended_family"),
    );
    expect(screen.getByLabelText("Include")).toHaveAccessibleDescription(
      "The selected person, their ancestors and descendants, siblings, aunts, uncles, cousins and their descendants, plus all these relatives' partners. Partners' own family branches are not followed.",
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Extended family" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(useSectionStore.getState().createSection).toHaveBeenCalledWith({
        name: "Extended family",
        root_member_id: "root",
        direction: "extended_family",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not load previews while closed or after clearing the seed", async () => {
    const { rerender } = render(
      <CreateSectionDialog
        open={false}
        onOpenChange={vi.fn()}
        initialRootMemberId="root"
      />,
    );
    expect(useSectionStore.getState().previewSection).not.toHaveBeenCalled();
    rerender(
      <CreateSectionDialog
        open
        onOpenChange={vi.fn()}
        initialRootMemberId="root"
      />,
    );
    await screen.findByText("3 people in this section");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByLabelText("Include")).not.toBeInTheDocument();
    expect(
      screen.queryByText("3 people in this section"),
    ).not.toBeInTheDocument();
    expect(useSectionStore.getState().previewSection).toHaveBeenCalledTimes(1);
  });
});
