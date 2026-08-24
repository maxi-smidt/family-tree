import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryStore } from "./useStoryStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { StoryDB } from "@/types/story";
import { Workspace } from "@/types/workspace";

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
  useStoryStore.setState({ stories: [] });
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useStoryStore — refreshStories", () => {
  it("clears stories when no tree is selected", async () => {
    useStoryStore.setState({ stories: [{ id: "stale" } as never] });

    await useStoryStore.getState().refreshStories();

    expect(useStoryStore.getState().stories).toHaveLength(0);
    expect(WorkspaceService.getStories).not.toHaveBeenCalled();
  });

  it("fetches and maps stories with member links", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
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
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.addStory).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);

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
    await useStoryStore
      .getState()
      .addStory([], { title: "Orphan", content: "" });

    expect(WorkspaceService.addStory).not.toHaveBeenCalled();
  });
});

describe("useStoryStore — updateStory", () => {
  it("calls WorkspaceService.updateStory, setStoryLinks and setStoryDocuments then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.updateStory).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setStoryLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setStoryDocuments).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);

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
    expect(WorkspaceService.setStoryDocuments).toHaveBeenCalledWith(TREE_ID, "s1", [
      "doc-1",
    ]);
  });

  it("leaves document links unchanged when document ids are omitted", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.updateStory).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.setStoryLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);

    await useStoryStore
      .getState()
      .updateStory("s1", { title: "Updated Legend", content: "Revised…" }, [
        "m2",
      ]);

    expect(WorkspaceService.setStoryDocuments).not.toHaveBeenCalled();
  });
});

describe("useStoryStore — setStoryDocuments", () => {
  it("calls WorkspaceService.setStoryDocuments then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.setStoryDocuments).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);

    await useStoryStore.getState().setStoryDocuments("s1", ["doc-1", "doc-2"]);

    expect(WorkspaceService.setStoryDocuments).toHaveBeenCalledWith(TREE_ID, "s1", [
      "doc-1",
      "doc-2",
    ]);
    expect(WorkspaceService.getStories).toHaveBeenCalled();
  });
});

describe("useStoryStore — removeStory", () => {
  it("calls WorkspaceService.removeStory then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.removeStory).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getStories).mockResolvedValue([]);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);

    await useStoryStore.getState().removeStory("s1");

    expect(WorkspaceService.removeStory).toHaveBeenCalledWith(TREE_ID, "s1");
    expect(WorkspaceService.getStories).toHaveBeenCalled();
  });
});

describe("useStoryStore — getStoriesByMember", () => {
  it("returns stories linked to the given member", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
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

describe("useStoryStore — stale-write guard", () => {
  it("does not write fetched data when the tree changed mid-flight", async () => {
    let resolve!: (v: StoryDB[]) => void;
    const pending = new Promise<StoryDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getStories).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useStoryStore.getState().refreshStories(TREE_ID);
    // user switches away before the fetch resolves
    useWorkspaceStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([STORY_DB]);
    await p;

    expect(useStoryStore.getState().stories).toHaveLength(0); // stale data dropped
  });

  it("does not write fetched data after disconnect", async () => {
    let resolve!: (v: StoryDB[]) => void;
    const pending = new Promise<StoryDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getStories).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([]);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useStoryStore.getState().refreshStories(TREE_ID);
    // user disconnects before the fetch resolves
    useWorkspaceStore.setState({ selectedTree: undefined });
    resolve([STORY_DB]);
    await p;

    expect(useStoryStore.getState().stories).toHaveLength(0); // stale data dropped
  });

  it("writes data when the explicit workspaceId is still active", async () => {
    let resolve!: (v: StoryDB[]) => void;
    const pending = new Promise<StoryDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getStories).mockReturnValue(pending);
    vi.mocked(WorkspaceService.getStoryMemberLinks).mockResolvedValue([
      { story_id: "s1", member_id: "m1" },
    ]);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useStoryStore.getState().refreshStories(TREE_ID);
    resolve([STORY_DB]);
    await p;

    expect(useStoryStore.getState().stories).toHaveLength(1);
    expect(useStoryStore.getState().stories[0].id).toBe("s1");
  });

  it("clear() empties the stories slice", () => {
    useStoryStore.setState({ stories: [{ id: "s1" } as never] });

    useStoryStore.getState().clear();

    expect(useStoryStore.getState().stories).toHaveLength(0);
  });
});
