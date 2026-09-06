import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskStore } from "./useTaskStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { clearTaskStore } from "./taskStoreRegistry";
import { WorkspaceService } from "@/services/WorkspaceService";
import { ResearchTaskDB } from "@/types/task";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-task";
const TREE: Workspace = { id: TREE_ID, name: "Task Workspace", role: "owner" };

const TASK_DB: ResearchTaskDB = {
  id: "t1",
  title: "Find birth record",
  notes: null,
  done: false,
  created_at: "2026-01-01T00:00:00Z",
  done_at: null,
  member_ids: ["m1"],
};

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    tasks: [],
    openTaskMemberIds: new Set(),
    initialized: false,
  });
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useTaskStore — refreshTasks", () => {
  it("clears tasks when no tree is selected", async () => {
    useTaskStore.setState({ tasks: [{ id: "stale" } as never] });

    await useTaskStore.getState().refreshTasks();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(WorkspaceService.getTasks).not.toHaveBeenCalled();
  });

  it("fetches and maps tasks with linked members", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getTasks).mockResolvedValue([TASK_DB]);

    await useTaskStore.getState().refreshTasks();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
    expect(tasks[0].linkedMemberIds).toEqual(["m1"]);
    expect(tasks[0].done).toBe(false);
    expect(useTaskStore.getState().openTaskMemberIds.has("m1")).toBe(true);
  });

  it("does not write fetched data when the tree changed mid-flight", async () => {
    let resolve!: (v: ResearchTaskDB[]) => void;
    const pending = new Promise<ResearchTaskDB[]>((r) => {
      resolve = r;
    });
    vi.mocked(WorkspaceService.getTasks).mockReturnValue(pending);
    useWorkspaceStore.setState({ selectedTree: TREE });

    const p = useTaskStore.getState().refreshTasks(TREE_ID);
    useWorkspaceStore.setState({
      selectedTree: { id: "other", name: "Other", role: "owner" },
    });
    resolve([TASK_DB]);
    await p;

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it("clears loaded task data through the tree lifecycle bridge", () => {
    useTaskStore.setState({
      tasks: [{ id: "stale" } as never],
      openTaskMemberIds: new Set(["m1"]),
      initialized: true,
    });

    clearTaskStore();

    expect(useTaskStore.getState()).toMatchObject({
      tasks: [],
      initialized: false,
    });
    expect(useTaskStore.getState().openTaskMemberIds).toEqual(new Set());
  });
});

describe("useTaskStore — addTask", () => {
  it("calls WorkspaceService.addTask with linked members then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.addTask).mockResolvedValue(TASK_DB);
    vi.mocked(WorkspaceService.getTasks).mockResolvedValue([TASK_DB]);

    await useTaskStore
      .getState()
      .addTask(["m1", "m2"], { title: "Find birth record" });

    expect(WorkspaceService.addTask).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      "Find birth record",
      null,
      expect.any(String),
      ["m1", "m2"],
    );
    expect(WorkspaceService.getTasks).toHaveBeenCalled();
  });

  it("creates a tree-level task with no linked members", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.addTask).mockResolvedValue(TASK_DB);
    vi.mocked(WorkspaceService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().addTask([], { title: "Scan family bible" });

    expect(WorkspaceService.addTask).toHaveBeenCalledWith(
      TREE_ID,
      expect.any(String),
      "Scan family bible",
      null,
      expect.any(String),
      [],
    );
  });

  it("does nothing when no tree is selected", async () => {
    await useTaskStore.getState().addTask([], { title: "Orphan" });

    expect(WorkspaceService.addTask).not.toHaveBeenCalled();
  });
});

describe("useTaskStore — updateTask", () => {
  it("updates fields and replaces member links", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    useTaskStore.setState({
      tasks: [
        {
          id: "t1",
          linkedMemberIds: ["m1"],
          title: "Find birth record",
          notes: "",
          done: false,
          createdAt: "2026-01-01T00:00:00Z",
          doneAt: null,
        },
      ],
    });
    vi.mocked(WorkspaceService.updateTask).mockResolvedValue(TASK_DB);
    vi.mocked(WorkspaceService.setTaskLinks).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getTasks).mockResolvedValue([]);

    await useTaskStore
      .getState()
      .updateTask("t1", { title: "Updated", notes: "n" }, ["m2"]);

    expect(WorkspaceService.updateTask).toHaveBeenCalledWith(
      TREE_ID,
      "t1",
      "Updated",
      "n",
      false,
      null,
    );
    expect(WorkspaceService.setTaskLinks).toHaveBeenCalledWith(TREE_ID, "t1", [
      "m2",
    ]);
  });
});

describe("useTaskStore — setTaskDone", () => {
  it("marks the task done with a done_at timestamp", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    useTaskStore.setState({
      tasks: [
        {
          id: "t1",
          linkedMemberIds: ["m1"],
          title: "Find birth record",
          notes: "",
          done: false,
          createdAt: "2026-01-01T00:00:00Z",
          doneAt: null,
        },
      ],
    });
    vi.mocked(WorkspaceService.updateTask).mockResolvedValue({
      ...TASK_DB,
      done: true,
    });
    vi.mocked(WorkspaceService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().setTaskDone("t1", true);

    expect(WorkspaceService.updateTask).toHaveBeenCalledWith(
      TREE_ID,
      "t1",
      "Find birth record",
      null,
      true,
      expect.any(String),
    );
  });

  it("clears done_at when reopening", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    useTaskStore.setState({
      tasks: [
        {
          id: "t1",
          linkedMemberIds: ["m1"],
          title: "Find birth record",
          notes: "",
          done: true,
          createdAt: "2026-01-01T00:00:00Z",
          doneAt: "2026-02-01T00:00:00Z",
        },
      ],
    });
    vi.mocked(WorkspaceService.updateTask).mockResolvedValue(TASK_DB);
    vi.mocked(WorkspaceService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().setTaskDone("t1", false);

    expect(WorkspaceService.updateTask).toHaveBeenCalledWith(
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
  it("calls WorkspaceService.removeTask then refreshes", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.removeTask).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getTasks).mockResolvedValue([]);

    await useTaskStore.getState().removeTask("t1");

    expect(WorkspaceService.removeTask).toHaveBeenCalledWith(TREE_ID, "t1");
    expect(WorkspaceService.getTasks).toHaveBeenCalled();
  });
});

describe("useTaskStore — selectors", () => {
  const tasks = [
    {
      id: "t1",
      linkedMemberIds: ["m1", "m2"],
      title: "Open for m1+m2",
      notes: "",
      done: false,
      createdAt: "2026-01-01T00:00:00Z",
      doneAt: null,
    },
    {
      id: "t2",
      linkedMemberIds: ["m1"],
      title: "Done for m1",
      notes: "",
      done: true,
      createdAt: "2026-01-02T00:00:00Z",
      doneAt: "2026-02-01T00:00:00Z",
    },
    {
      id: "t3",
      linkedMemberIds: [],
      title: "Workspace-level",
      notes: "",
      done: false,
      createdAt: "2026-01-03T00:00:00Z",
      doneAt: null,
    },
  ];

  it("getTasksByMember returns tasks linked to the given member", () => {
    useTaskStore.setState({ tasks });
    expect(
      useTaskStore
        .getState()
        .getTasksByMember("m1")
        .map((t) => t.id),
    ).toEqual(["t1", "t2"]);
    expect(
      useTaskStore
        .getState()
        .getTasksByMember("m2")
        .map((t) => t.id),
    ).toEqual(["t1"]);
  });

  it("clear() empties the tasks slice", () => {
    useTaskStore.setState({ tasks, initialized: true });

    useTaskStore.getState().clear();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(useTaskStore.getState().initialized).toBe(false);
  });
});
