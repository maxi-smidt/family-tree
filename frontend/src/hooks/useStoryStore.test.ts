import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryStore } from "./useStoryStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { StoryDB } from "@/types/story";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");

const TREE_ID = "tree-story";
const TREE: Tree = { id: TREE_ID, name: "Story Tree", role: "owner" };

const STORY_DB: StoryDB = {
  id: "s1",
  title: "A Family Legend",
  content: "Once upon a time…",
  created_at: "2024-03-01T00:00:00Z",
  updated_at: "2024-03-01T00:00:00Z",
  attachments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useStoryStore.setState({ stories: [] });
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useStoryStore — refreshStories", () => {
  it("clears stories when no tree is selected", async () => {
    useStoryStore.setState({ stories: [{ id: "stale" } as never] });

    await useStoryStore.getState().refreshStories();

    expect(useStoryStore.getState().stories).toHaveLength(0);
    expect(TreeService.getStories).not.toHaveBeenCalled();
  });

  it("fetches and maps stories with member links", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getStories).mockResolvedValue([STORY_DB]);
    vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([
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
  it("calls TreeService.addStory and TreeService.setStoryLinks then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.addStory).mockResolvedValue(undefined);
    vi.mocked(TreeService.getStories).mockResolvedValue([]);
    vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([]);

    await useStoryStore
      .getState()
      .addStory(["m1"], { title: "New Story", content: "Content here" });

    expect(TreeService.addStory).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      expect.objectContaining({ title: "New Story" }),
      expect.any(String),
      ["m1"],
    );
    expect(TreeService.getStories).toHaveBeenCalled();
  });

  it("does nothing when no tree is selected", async () => {
    await useStoryStore
      .getState()
      .addStory([], { title: "Orphan", content: "" });

    expect(TreeService.addStory).not.toHaveBeenCalled();
  });
});

describe("useStoryStore — updateStory", () => {
  it("calls TreeService.updateStory and setStoryLinks then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.updateStory).mockResolvedValue(undefined);
    vi.mocked(TreeService.setStoryLinks).mockResolvedValue(undefined);
    vi.mocked(TreeService.getStories).mockResolvedValue([]);
    vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([]);

    await useStoryStore
      .getState()
      .updateStory("s1", { title: "Updated Legend", content: "Revised…" }, [
        "m2",
      ]);

    expect(TreeService.updateStory).toHaveBeenCalledWith(
      TREE_ID,
      "s1",
      expect.objectContaining({ title: "Updated Legend" }),
      expect.any(String),
    );
    expect(TreeService.setStoryLinks).toHaveBeenCalledWith(TREE_ID, "s1", [
      "m2",
    ]);
  });
});

describe("useStoryStore — removeStory", () => {
  it("calls TreeService.removeStory then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.removeStory).mockResolvedValue(undefined);
    vi.mocked(TreeService.getStories).mockResolvedValue([]);
    vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([]);

    await useStoryStore.getState().removeStory("s1");

    expect(TreeService.removeStory).toHaveBeenCalledWith(TREE_ID, "s1");
    expect(TreeService.getStories).toHaveBeenCalled();
  });
});

describe("useStoryStore — getStoriesByMember", () => {
  it("returns stories linked to the given member", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getStories).mockResolvedValue([
      STORY_DB,
      { ...STORY_DB, id: "s2", title: "Other Story" },
    ]);
    vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([
      { story_id: "s1", member_id: "m1" },
      { story_id: "s2", member_id: "m2" },
    ]);

    await useStoryStore.getState().refreshStories();

    const result = useStoryStore.getState().getStoriesByMember("m1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });
});
