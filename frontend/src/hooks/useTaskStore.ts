import { create } from "zustand";
import { ResearchTask, ResearchTaskInput, mapTaskFromDB } from "@/types/task";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { invalidateActivityView } from "@/hooks/invalidateDerivedViews";

interface TaskState {
  tasks: ResearchTask[];
  initialized: boolean;
  refreshTasks: (treeId?: string) => Promise<void>;
  getTasksByMember: (memberId: string) => ResearchTask[];
  getOpenTasks: () => ResearchTask[];
  hasOpenTasks: (memberId: string) => boolean;
  addTask: (task: ResearchTaskInput) => Promise<void>;
  updateTask: (id: string, task: ResearchTaskInput) => Promise<void>;
  setTaskDone: (id: string, done: boolean) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  clear: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  initialized: false,

  refreshTasks: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ tasks: [] });
      return;
    }
    // Research tasks are working data of a real tree; virtual views have no
    // task endpoints.
    if (treeId.startsWith("vv_")) {
      set({ tasks: [], initialized: true });
      return;
    }

    const rows = await TreeService.getTasks(treeId);
    if (!isActiveTree(treeId)) return; // tree switched mid-flight — drop stale data

    set({ tasks: rows.map(mapTaskFromDB), initialized: true });
  },

  getTasksByMember: (memberId: string) => {
    return get().tasks.filter((t) => t.memberId === memberId);
  },

  getOpenTasks: () => {
    return get().tasks.filter((t) => !t.done);
  },

  hasOpenTasks: (memberId: string) => {
    return get().tasks.some((t) => t.memberId === memberId && !t.done);
  },

  addTask: async (task: ResearchTaskInput) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    await TreeService.addTask(
      treeId,
      crypto.randomUUID(),
      task.memberId ?? null,
      task.title,
      task.notes || null,
      new Date().toISOString(),
    );

    await get().refreshTasks(treeId);
    invalidateActivityView();
  },

  updateTask: async (id: string, task: ResearchTaskInput) => {
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

  clear: () => set({ tasks: [], initialized: false }),
}));
