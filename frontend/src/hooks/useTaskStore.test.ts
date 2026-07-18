import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskStore } from "./useTaskStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { ResearchTaskDB } from "@/types/task";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");

const TREE_ID = "tree-task";
const TREE: Tree = { id: TREE_ID, name: "Task Tree", role: "owner" };

const TASK_DB: ResearchTaskDB = {
  id: "t1",
  member_id: "m1",
  title: "Find birth record",
  notes: null,
  done: false,
  created_at: "2026-01-01T00:00:00Z",
  done_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    tasks: [],
    openTaskMemberIds: new Set(),
    initialized: false,
  });
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useTaskStore — refreshTasks", () => {
  it("clears tasks when no tree is selected", async () => {
    useTaskStore.setState({ tasks: [{ id: "stale" } as never] });

    await useTaskStore.getState().refreshTasks();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(TreeService.getTasks).not.toHaveBeenCalled();
  });

  it("fetches and maps tasks", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getTasks).mockResolvedValue([TASK_DB]);

    await useTaskStore.getState().refreshTasks();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
    expect(tasks[0].memberId).toBe("m1");
    expect(tasks[0].done).toBe(false);
    expect(useTaskStore.getState().openTaskMemberIds.has("m1")).toBe(true);
  });

  it("skips the API for virtual views and marks the store initialized", async () => {
    const view: Tree = { id: "vv_1", name: "View", role: "viewer" };
    useTreeStore.setState({ selectedTree: view });

    await useTaskStore.getState().refreshTasks("vv_1");

    expect(TreeService.getTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState().initialized).toBe(true);
  });

  it("does not write fetched data when the tree changed mid-flight", async () => {
    let resolve!: (v: ResearchTaskDB[]) => void;
    const pending = new Promise<ResearchTaskDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(TreeService.getTasks).mockReturnValue(pending);
    useTreeStore.setState({ selectedTree: TREE });

    const p = useTaskStore.getState().refreshTasks(TREE_ID);
    useTreeStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([TASK_DB]);
    await p;

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });
});

describe("useTaskStore — addTask", () => {
  it("calls TreeService.addTask then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.addTask).mockResolvedValue(TASK_DB);
    vi.mocked(TreeService.getTasks).mockResolvedValue([TASK_DB]);

    await useTaskStore
      .getState()
      .addTask({ memberId: "m1", title: "Find birth record" });

    expect(TreeService.addTask).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      "m1",
      "Find birth record",
      null,
      expect.any(String),
    );
    expect(TreeService.getTasks).toHaveBeenCalled();
  });

  it("creates a tree-level task when memberId is omitted", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.addTask).mockResolvedValue(TASK_DB);
    vi.mocked(TreeService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().addTask({ title: "Scan family bible" });

    expect(TreeService.addTask).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      null,
      "Scan family bible",
      null,
      expect.any(String),
    );
  });

  it("does nothing when no tree is selected", async () => {
    await useTaskStore.getState().addTask({ title: "Orphan" });

    expect(TreeService.addTask).not.toHaveBeenCalled();
  });
});

describe("useTaskStore — setTaskDone", () => {
  it("marks the task done with a done_at timestamp", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    useTaskStore.setState({
      tasks: [
        {
          id: "t1",
          memberId: "m1",
          title: "Find birth record",
          notes: "",
          done: false,
          createdAt: "2026-01-01T00:00:00Z",
          doneAt: null,
        },
      ],
    });
    vi.mocked(TreeService.updateTask).mockResolvedValue({
      ...TASK_DB,
      done: true,
    });
    vi.mocked(TreeService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().setTaskDone("t1", true);

    expect(TreeService.updateTask).toHaveBeenCalledWith(
      TREE_ID,
      "t1",
      "Find birth record",
      null,
      true,
      expect.any(String),
    );
  });

  it("clears done_at when reopening", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    useTaskStore.setState({
      tasks: [
        {
          id: "t1",
          memberId: "m1",
          title: "Find birth record",
          notes: "",
          done: true,
          createdAt: "2026-01-01T00:00:00Z",
          doneAt: "2026-02-01T00:00:00Z",
        },
      ],
    });
    vi.mocked(TreeService.updateTask).mockResolvedValue(TASK_DB);
    vi.mocked(TreeService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().setTaskDone("t1", false);

    expect(TreeService.updateTask).toHaveBeenCalledWith(
      TREE_ID,
      "t1",
      "Find birth record",
      null,
      false,
      null,
    );
  });
});

describe("useTaskStore — removeTask", () => {
  it("calls TreeService.removeTask then refreshes", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.removeTask).mockResolvedValue(undefined);
    vi.mocked(TreeService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().removeTask("t1");

    expect(TreeService.removeTask).toHaveBeenCalledWith(TREE_ID, "t1");
    expect(TreeService.getTasks).toHaveBeenCalled();
  });
});

describe("useTaskStore — selectors", () => {
  const tasks = [
    {
      id: "t1",
      memberId: "m1",
      title: "Open for m1",
      notes: "",
      done: false,
      createdAt: "2026-01-01T00:00:00Z",
      doneAt: null,
    },
    {
      id: "t2",
      memberId: "m1",
      title: "Done for m1",
      notes: "",
      done: true,
      createdAt: "2026-01-02T00:00:00Z",
      doneAt: "2026-02-01T00:00:00Z",
    },
    {
      id: "t3",
      memberId: null,
      title: "Tree-level",
      notes: "",
      done: false,
      createdAt: "2026-01-03T00:00:00Z",
      doneAt: null,
    },
  ];

  it("getTasksByMember returns only that member's tasks", () => {
    useTaskStore.setState({ tasks });
    const result = useTaskStore.getState().getTasksByMember("m1");
    expect(result.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("clear() empties the tasks slice", () => {
    useTaskStore.setState({ tasks, initialized: true });

    useTaskStore.getState().clear();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(useTaskStore.getState().initialized).toBe(false);
  });
});
