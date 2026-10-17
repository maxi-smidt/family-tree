import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSectionStore } from "./useSectionStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { SectionDB } from "@/types/section";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-sec";

function makeTree(id = TREE_ID): Workspace {
  return { id, name: "Sections Workspace", role: "owner" };
}

function makeSection(overrides: Partial<SectionDB> = {}): SectionDB {
  return {
    id: "s1",
    workspace_id: TREE_ID,
    name: "Main family",
    position: 0,
    created_at: "2024-01-01T00:00:00Z",
    member_count: 3,
    can_write: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSectionStore.setState({
    sections: [],
    initialized: false,
    loading: false,
  });
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useSectionStore — refreshSections", () => {
  it("clears sections when no tree is selected", async () => {
    useSectionStore.setState({ sections: [makeSection()], initialized: true });

    await useSectionStore.getState().refreshSections();

    expect(useSectionStore.getState().sections).toHaveLength(0);
    expect(useSectionStore.getState().initialized).toBe(false);
    expect(WorkspaceService.getSections).not.toHaveBeenCalled();
  });

  it("fetches sections from the service", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.getSections).mockResolvedValue([makeSection()]);

    await useSectionStore.getState().refreshSections();

    expect(WorkspaceService.getSections).toHaveBeenCalledWith(TREE_ID);
    expect(useSectionStore.getState().sections).toHaveLength(1);
    expect(useSectionStore.getState().initialized).toBe(true);
  });

  it("drops a response superseded by a tree switch mid-flight", async () => {
    let resolve!: (v: SectionDB[]) => void;
    const pending = new Promise<SectionDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getSections).mockReturnValue(pending);
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    const p = useSectionStore.getState().refreshSections(TREE_ID);
    useWorkspaceStore.setState({ selectedTree: makeTree("other") });
    resolve([makeSection()]);
    await p;

    expect(useSectionStore.getState().sections).toHaveLength(0);
  });
});

describe("useSectionStore — createSection", () => {
  it("creates a section then refreshes the list", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.createSection).mockResolvedValue(makeSection());
    vi.mocked(WorkspaceService.getSections).mockResolvedValue([makeSection()]);

    await useSectionStore.getState().createSection({ name: "Main family" });

    expect(WorkspaceService.createSection).toHaveBeenCalledWith(TREE_ID, {
      name: "Main family",
    });
    expect(WorkspaceService.getSections).toHaveBeenCalled();
  });

  it("throws when no tree is selected", async () => {
    await expect(
      useSectionStore.getState().createSection({ name: "Orphan" }),
    ).rejects.toThrow();
    expect(WorkspaceService.createSection).not.toHaveBeenCalled();
  });
});

describe("useSectionStore — deleteSection", () => {
  it("deletes a section then refreshes the list", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.deleteSection).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getSections).mockResolvedValue([]);

    await useSectionStore.getState().deleteSection("s1");

    expect(WorkspaceService.deleteSection).toHaveBeenCalledWith(
      TREE_ID,
      "s1",
      undefined,
    );
    expect(WorkspaceService.getSections).toHaveBeenCalled();
  });
});

describe("useSectionStore — addMemberToSections", () => {
  it("unions the new member into each section's current membership", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.getSectionMembers).mockImplementation(
      (_workspaceId, sectionId) =>
        Promise.resolve(
          sectionId === "s1" ? [{ id: "existing" } as never] : [],
        ),
    );
    vi.mocked(WorkspaceService.setSectionMembers).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getSections).mockResolvedValue([]);

    await useSectionStore
      .getState()
      .addMemberToSections("new-member", ["s1", "s2"]);

    expect(WorkspaceService.setSectionMembers).toHaveBeenCalledWith(
      TREE_ID,
      "s1",
      expect.arrayContaining(["existing", "new-member"]),
    );
    expect(WorkspaceService.setSectionMembers).toHaveBeenCalledWith(
      TREE_ID,
      "s2",
      ["new-member"],
    );
    expect(WorkspaceService.getSections).toHaveBeenCalled();
  });

  it("does nothing for an empty section list", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });

    await useSectionStore.getState().addMemberToSections("new-member", []);

    expect(WorkspaceService.getSectionMembers).not.toHaveBeenCalled();
    expect(WorkspaceService.setSectionMembers).not.toHaveBeenCalled();
  });
});

describe("useSectionStore — clear", () => {
  it("empties the sections slice", () => {
    useSectionStore.setState({ sections: [makeSection()], initialized: true });

    useSectionStore.getState().clear();

    expect(useSectionStore.getState().sections).toHaveLength(0);
    expect(useSectionStore.getState().initialized).toBe(false);
  });
});
