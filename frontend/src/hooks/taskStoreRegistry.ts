/**
 * Lightweight bridge for eager session/realtime code to notify the optional
 * research-task store without importing the task feature into the initial
 * bundle. Until a task UI has loaded the store, there is no task state to
 * clear or refresh.
 */

interface TaskStoreActions {
  clear: () => void;
  refresh: (treeId: string) => void;
}

let actions: TaskStoreActions | undefined;

export const registerTaskStoreActions = (
  nextActions: TaskStoreActions,
): void => {
  actions = nextActions;
};

export const clearTaskStore = (): void => {
  actions?.clear();
};

export const refreshTaskStore = (treeId: string): void => {
  actions?.refresh(treeId);
};
