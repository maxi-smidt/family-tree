import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryStore } from "./useStoryStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { StoryDB, mapStoryFromDB } from "@/types/story";
import { Workspace } from "@/types/workspace";

import { testLinkedContentLifecycle } from "@/test/linkedContentStore";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-story";
const TREE: Workspace = { id: TREE_ID, name: "Story Workspace", role: "owner" };

const STORY_DB: StoryDB = {
  id: "s1",
  title: "A Family Legend",
  content: "Once upon a time…",
  created_at: "2024-03-01T00:00:00Z",
  updated_at: "2024-03-01T00:00:00Z",
  document_ids: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useStoryStore.getState().clear();
  useWorkspaceStore.setState({ selectedTree: TREE });
  vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);
});

describe("useStoryStore — refreshStories", () => {
  it("fetches and maps stories with member links", async () => {
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([STORY_DB]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([
      { story_id: "s1", member_id: "m1" },
    ]);

    await useStoryStore.getState().refreshStories();

    const stories = useStoryStore.getState().stories;
    expect(stories).toHaveLength(1);
    expect(stories[0].id).toBe("s1");
    expect(stories[0].title).toBe("A Family Legend");
    expect(stories[0].linkedMemberIds).toEqual(["m1"]);
  });
});

describe("useStoryStore — addStory", () => {
  it("calls WorkspaceService.addStory and WorkspaceService.setStoryLinks then refreshes", async () => {
    vi.mocked(WorkspaceService.addStory).mockResolvedValue(undefined);

    await useStoryStore
      .getState()
      .addStory(["m1"], { title: "New Story", content: "Content here" });

    expect(WorkspaceService.addStory).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      expect.objectContaining({ title: "New Story" }),
      expect.any(String),
      ["m1"],
    );
    expect(WorkspaceService.getStories).toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    useWorkspaceStore.setState({ selectedTree: undefined });
    await useStoryStore
      .getState()
      .addStory([], { title: "Orphan", content: "" });

    expect(WorkspaceService.addStory).not.toHaveBeenCalled();
  });
});

describe("useStoryStore — updateStory", () => {
  it("calls WorkspaceService.updateStory, setStoryLinks and setStoryDocuments then refreshes", async () => {
    vi.mocked(WorkspaceService.updateStory).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setStoryLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setStoryDocuments).mockResolvedValue(undefined);

    await useStoryStore
      .getState()
      .updateStory(
        "s1",
        { title: "Updated Legend", content: "Revised…" },
        ["m2"],
        ["doc-1"],
      );

    expect(WorkspaceService.updateStory).toHaveBeenCalledWith(
      TREE_ID,
      "s1",
      expect.objectContaining({ title: "Updated Legend" }),
      expect.any(String),
    );
    expect(WorkspaceService.setStoryLinks).toHaveBeenCalledWith(TREE_ID, "s1", [
      "m2",
    ]);
    expect(WorkspaceService.setStoryDocuments).toHaveBeenCalledWith(
      TREE_ID,
      "s1",
      ["doc-1"],
    );
    expect(WorkspaceService.getStories).toHaveBeenCalledWith(TREE_ID);
  });

  it.each([
    { label: "omitted", documentIds: undefined },
    { label: "explicitly cleared", documentIds: [] },
  ])("handles $label document links", async ({ documentIds }) => {
    await useStoryStore
      .getState()
      .updateStory(
        "s1",
        { title: "Updated Legend", content: "Revised…" },
        ["m2"],
        documentIds,
      );

    if (documentIds === undefined) {
      expect(WorkspaceService.setStoryDocuments).not.toHaveBeenCalled();
    } else {
      expect(WorkspaceService.setStoryDocuments).toHaveBeenCalledWith(
        TREE_ID,
        "s1",
        [],
      );
    }
    expect(WorkspaceService.getStories).toHaveBeenCalledWith(TREE_ID);
  });
});

describe("useStoryStore — setStoryDocuments", () => {
  it("calls WorkspaceService.setStoryDocuments then refreshes", async () => {
    vi.mocked(WorkspaceService.setStoryDocuments).mockResolvedValue(undefined);

    await useStoryStore.getState().setStoryDocuments("s1", ["doc-1", "doc-2"]);

    expect(WorkspaceService.setStoryDocuments).toHaveBeenCalledWith(
      TREE_ID,
      "s1",
      ["doc-1", "doc-2"],
    );
    expect(WorkspaceService.getStories).toHaveBeenCalled();
  });
});

describe("useStoryStore — removeStory", () => {
  it("calls WorkspaceService.removeStory then refreshes", async () => {
    vi.mocked(WorkspaceService.removeStory).mockResolvedValue(undefined);

    await useStoryStore.getState().removeStory("s1");

    expect(WorkspaceService.removeStory).toHaveBeenCalledWith(TREE_ID, "s1");
    expect(WorkspaceService.getStories).toHaveBeenCalled();
  });
});

describe("useStoryStore — getStoriesByMember", () => {
  it("returns stories linked to the given member", async () => {
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([
      STORY_DB,
      { ...STORY_DB, id: "s2", title: "Other Story" },
    ]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([
      { story_id: "s1", member_id: "m1" },
      { story_id: "s2", member_id: "m2" },
    ]);

    await useStoryStore.getState().refreshStories();

    const result = useStoryStore.getState().getStoriesByMember("m1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });
});

testLinkedContentLifecycle({
  name: "useStoryStore",
  workspace: TREE,
  row: STORY_DB,
  fetchRows: vi.mocked(WorkspaceService.getStories),
  refresh: (id) => useStoryStore.getState().refreshStories(id),
  items: () => useStoryStore.getState().stories,
  initialized: () => useStoryStore.getState().initialized,
  seed: () =>
    useStoryStore.setState({
      stories: [mapStoryFromDB(STORY_DB, [])],
      initialized: true,
    }),
  clear: () => useStoryStore.getState().clear(),
});
