import { create } from "zustand";

interface Guard {
  requestSave: () => Promise<boolean>;
}

interface UnsavedChangesState {
  guards: Record<string, Guard>;
  pendingNav: (() => void) | null;
  dialogOpen: boolean;

  register: (id: string, guard: Guard) => void;
  unregister: (id: string) => void;
  hasUnsaved: () => boolean;
  guardNavigate: (action: () => void) => void;
  resolveStay: () => void;
  resolveDiscard: () => void;
  resolveSave: () => Promise<void>;
}

export const useUnsavedChangesStore = create<UnsavedChangesState>(
  (set, get) => ({
    guards: {},
    pendingNav: null,
    dialogOpen: false,

    register: (id, guard) =>
      set((s) => ({ guards: { ...s.guards, [id]: guard } })),

    unregister: (id) =>
      set((s) => {
        const next = { ...s.guards };
        delete next[id];
        return { guards: next };
      }),

    hasUnsaved: () => Object.keys(get().guards).length > 0,

    guardNavigate: (action) => {
      if (!get().hasUnsaved()) {
        action();
        return;
      }
      set({ pendingNav: action, dialogOpen: true });
    },

    resolveStay: () => set({ pendingNav: null, dialogOpen: false }),

    resolveDiscard: () => {
      const { pendingNav } = get();
      set({ guards: {}, pendingNav: null, dialogOpen: false });
      pendingNav?.();
    },

    resolveSave: async () => {
      const guards = Object.values(get().guards);
      const results = await Promise.all(guards.map((g) => g.requestSave()));
      if (results.every(Boolean)) {
        const { pendingNav } = get();
        set({ guards: {}, pendingNav: null, dialogOpen: false });
        pendingNav?.();
      }
    },
  }),
);
