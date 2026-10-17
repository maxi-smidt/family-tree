/**
 * Lightweight bridge for eager session/realtime code to notify the optional
 * research-task store without importing the task feature into the initial
 * bundle. Until a task UI has loaded the store, there is no task state to
 * clear or refresh.
 */

interface TaskStoreActions {
  clear: () => void;
  refresh: (workspaceId: string) => void;
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

export const refreshTaskStore = (workspaceId: string): void => {
  actions?.refresh(workspaceId);
};
