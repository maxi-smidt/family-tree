import { create } from "zustand";
import { ResearchTask, ResearchTaskInput, mapTaskFromDB } from "@/types/task";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree, isVirtualId } from "@/hooks/useTreeStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";
import { registerTaskStoreActions } from "@/hooks/taskStoreRegistry";

interface TaskState {
  tasks: ResearchTask[];
  /** Members with at least one open task — O(1) lookups for tree nodes. */
  openTaskMemberIds: Set<string>;
  initialized: boolean;
  refreshTasks: (treeId?: string) => Promise<void>;
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

  refreshTasks: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ tasks: [], openTaskMemberIds: new Set() });
      return;
    }
    // Research tasks are working data of a real tree; virtual views have no
    // task endpoints.
    if (isVirtualId(treeId)) {
      set({ tasks: [], openTaskMemberIds: new Set(), initialized: true });
      return;
    }

    const rows = await TreeService.getTasks(treeId);
    if (!isActiveTree(treeId)) return; // tree switched mid-flight — drop stale data

    const tasks = rows.map(mapTaskFromDB);
    set({ tasks, openTaskMemberIds: openMemberIds(tasks), initialized: true });
  },

  getTasksByMember: (memberId: string) => {
    return get().tasks.filter((t) => t.linkedMemberIds.includes(memberId));
  },

  addTask: async (memberIds: string[], task: ResearchTaskInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.addTask(
      treeId,
      crypto.randomUUID(),
      task.title,
      task.notes || null,
      new Date().toISOString(),
      memberIds,
    );

    await get().refreshTasks(treeId);
    invalidateActivityView();
  },

  updateTask: async (
    id: string,
    task: ResearchTaskInput,
    memberIds: string[],
  ) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const current = get().tasks.find((t) => t.id === id);
    if (!current) return;

    await TreeService.updateTask(
      treeId,
      id,
      task.title,
      task.notes || null,
      current.done,
      current.doneAt,
    );
    await TreeService.setTaskLinks(treeId, id, memberIds);

    await get().refreshTasks(treeId);
    invalidateActivityView();
  },

  setTaskDone: async (id: string, done: boolean) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    const current = get().tasks.find((t) => t.id === id);
    if (!current) return;

    await TreeService.updateTask(
      treeId,
      id,
      current.title,
      current.notes || null,
      done,
      done ? new Date().toISOString() : null,
    );

    await get().refreshTasks(treeId);
    invalidateActivityView();
  },

  removeTask: async (id: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.removeTask(treeId, id);
    await get().refreshTasks(treeId);
    invalidateActivityView();
  },

  clear: () =>
    set({ tasks: [], openTaskMemberIds: new Set(), initialized: false }),
}));

registerTaskStoreActions({
  clear: () => useTaskStore.getState().clear(),
  refresh: (treeId) => void useTaskStore.getState().refreshTasks(treeId),
});
