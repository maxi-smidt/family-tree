import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { SectionDB } from "@/types/section";
import {
  MemberDB,
  WorkspaceSearchHitDB,
  WorkspaceSearchResultDB,
} from "@/types/member";
import { SectionMembersDialog } from "./SectionMembersDialog";

const SECTION: SectionDB = {
  id: "s1",
  workspace_id: "tree-1",
  name: "Vienna branch",
  position: 0,
  created_at: "2024-01-01T00:00:00Z",
  member_count: 1,
  can_write: true,
};

function makeMember(overrides: Partial<MemberDB> = {}): MemberDB {
  return {
    id: "m1",
    gender: "female",
    academicTitle: null,
    firstName: "Anna",
    middleNames: null,
    baptismalName: null,
    lastName: "Adams",
    maidenName: null,
    imageData: null,
    dateOfBirth: null,
    dateOfDeath: null,
    deceased: false,
    adopted: false,
    isCollapsed: 0,
    positionX: 0,
    positionY: 0,
    ...overrides,
  };
}

function makeHit(
  overrides: Partial<WorkspaceSearchHitDB> = {},
): WorkspaceSearchHitDB {
  return {
    ...makeMember({ id: "m2", firstName: "Bea", lastName: "Baker" }),
    sections: [],
    unassigned: true,
    ...overrides,
  };
}

function setStores(overrides: {
  getSectionMembers: () => Promise<MemberDB[]>;
  setSectionMembers?: () => Promise<void>;
  searchWorkspace?: () => Promise<WorkspaceSearchResultDB>;
}) {
  useSectionStore.setState({
    getSectionMembers: overrides.getSectionMembers,
    setSectionMembers:
      overrides.setSectionMembers ?? vi.fn().mockResolvedValue(undefined),
  });
  useMemberStore.setState({
    searchWorkspace:
      overrides.searchWorkspace ??
      vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        has_more: false,
        next_cursor: null,
      }),
  });
}

describe("SectionMembersDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the section's current members", async () => {
    setStores({
      getSectionMembers: () => Promise.resolve([makeMember()]),
    });

    render(
      <SectionMembersDialog
        section={SECTION}
        workspaceId="tree-1"
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Anna Adams")).toBeInTheDocument();
  });

  it("removes a member locally and saves the reduced list", async () => {
    const setSectionMembers = vi.fn().mockResolvedValue(undefined);
    setStores({
      getSectionMembers: () => Promise.resolve([makeMember()]),
      setSectionMembers,
    });
    const onOpenChange = vi.fn();

    render(
      <SectionMembersDialog
        section={SECTION}
        workspaceId="tree-1"
        onOpenChange={onOpenChange}
      />,
    );

    await screen.findByText("Anna Adams");
    fireEvent.click(screen.getByRole("button", { name: "Remove Anna Adams" }));
    expect(screen.queryByText("Anna Adams")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(setSectionMembers).toHaveBeenCalledWith("s1", []),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("adds a search hit, showing which other sections it already belongs to", async () => {
    const searchWorkspace = vi.fn().mockResolvedValue({
      items: [
        makeHit({
          sections: [{ id: "s2", name: "Other branch" }],
          unassigned: false,
        }),
      ],
      total: 1,
      has_more: false,
      next_cursor: null,
    });
    const setSectionMembers = vi.fn().mockResolvedValue(undefined);
    setStores({
      getSectionMembers: () => Promise.resolve([]),
      searchWorkspace,
      setSectionMembers,
    });

    render(
      <SectionMembersDialog
        section={SECTION}
        workspaceId="tree-1"
        onOpenChange={vi.fn()}
      />,
    );

    await screen.findByText("No members yet");
    fireEvent.change(
      screen.getByPlaceholderText("Search this workspace to add someone…"),
      { target: { value: "Bea" } },
    );

    await waitFor(() =>
      expect(searchWorkspace).toHaveBeenCalledWith("tree-1", "Bea", 10),
    );
    const hit = await screen.findByText("Bea Baker");
    expect(screen.getByText("Other branch")).toBeInTheDocument();

    fireEvent.click(hit);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(setSectionMembers).toHaveBeenCalledWith("s1", ["m2"]),
    );
  });

  it("shows a load error when the current membership can't be fetched", async () => {
    setStores({
      getSectionMembers: () => Promise.reject(new Error("network error")),
    });

    render(
      <SectionMembersDialog
        section={SECTION}
        workspaceId="tree-1"
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Could not load this section's members."),
    ).toBeInTheDocument();
  });
});
