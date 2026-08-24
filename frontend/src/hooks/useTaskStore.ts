import { create } from "zustand";
import { ResearchTask, ResearchTaskInput, mapTaskFromDB } from "@/types/task";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree, isVirtualId } from "@/hooks/useWorkspaceStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";
import { registerTaskStoreActions } from "@/hooks/taskStoreRegistry";

interface TaskState {
  tasks: ResearchTask[];
  /** Members with at least one open task — O(1) lookups for tree nodes. */
  openTaskMemberIds: Set<string>;
  initialized: boolean;
  refreshTasks: (workspaceId?: string) => Promise<void>;
  getTasksByMember: (memberId: string) => ResearchTask[];
  addTask: (memberIds: string[], task: ResearchTaskInput) => Promise<void>;
  updateTask: (
    id: string,
    task: ResearchTaskInput,
    memberIds: string[],
  ) => Promise<void>;
  setTaskDone: (id: string, done: boolean) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  clear: () => void;
}

const openMemberIds = (tasks: ResearchTask[]): Set<string> =>
  new Set(tasks.filter((t) => !t.done).flatMap((t) => t.linkedMemberIds));

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  openTaskMemberIds: new Set<string>(),
  initialized: false,

  refreshTasks: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ tasks: [], openTaskMemberIds: new Set() });
      return;
    }
    // Research tasks are working data of a real tree; virtual views have no
    // task endpoints.
    if (isVirtualId(workspaceId)) {
      set({ tasks: [], openTaskMemberIds: new Set(), initialized: true });
      return;
    }

    const rows = await WorkspaceService.getTasks(workspaceId);
    if (!isActiveTree(workspaceId)) return; // tree switched mid-flight — drop stale data

    const tasks = rows.map(mapTaskFromDB);
    set({ tasks, openTaskMemberIds: openMemberIds(tasks), initialized: true });
  },

  getTasksByMember: (memberId: string) => {
    return get().tasks.filter((t) => t.linkedMemberIds.includes(memberId));
  },

  addTask: async (memberIds: string[], task: ResearchTaskInput) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.addTask(
      workspaceId,
      crypto.randomUUID(),
      task.title,
      task.notes || null,
      new Date().toISOString(),
      memberIds,
    );

    await get().refreshTasks(workspaceId);
    invalidateActivityView();
  },

  updateTask: async (
    id: string,
    task: ResearchTaskInput,
    memberIds: string[],
  ) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    const current = get().tasks.find((t) => t.id === id);
    if (!current) return;

    await WorkspaceService.updateTask(
      workspaceId,
      id,
      task.title,
      task.notes || null,
      current.done,
      current.doneAt,
    );
    await WorkspaceService.setTaskLinks(workspaceId, id, memberIds);

    await get().refreshTasks(workspaceId);
    invalidateActivityView();
  },

  setTaskDone: async (id: string, done: boolean) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    const current = get().tasks.find((t) => t.id === id);
    if (!current) return;

    await WorkspaceService.updateTask(
      workspaceId,
      id,
      current.title,
      current.notes || null,
      done,
      done ? new Date().toISOString() : null,
    );

    await get().refreshTasks(workspaceId);
    invalidateActivityView();
  },

  removeTask: async (id: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;

    await WorkspaceService.removeTask(workspaceId, id);
    await get().refreshTasks(workspaceId);
    invalidateActivityView();
  },

  clear: () =>
    set({ tasks: [], openTaskMemberIds: new Set(), initialized: false }),
}));

registerTaskStoreActions({
  clear: () => useTaskStore.getState().clear(),
  refresh: (workspaceId) => void useTaskStore.getState().refreshTasks(workspaceId),
});
