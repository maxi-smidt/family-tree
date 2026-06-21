import { create } from "zustand";

interface PendingJob {
  resolve: (treeId: string) => void;
  reject: (err: Error) => void;
}

// Module-level map so mutations don't trigger spurious re-renders.
const _pending = new Map<string, PendingJob>();

interface JobStoreState {
  activeJobId: string | null;
  activeJobPct: number;

  /** Register a job and return a Promise that resolves with its result_tree_id. */
  trackJob: (jobId: string) => Promise<string>;
  onProgress: (jobId: string, pct: number) => void;
  onDone: (jobId: string, treeId: string) => void;
  onFailed: (jobId: string, error: string) => void;
}

export const useJobStore = create<JobStoreState>((set, get) => ({
  activeJobId: null,
  activeJobPct: 0,

  trackJob: (jobId: string) =>
    new Promise<string>((resolve, reject) => {
      _pending.set(jobId, { resolve, reject });
      set({ activeJobId: jobId, activeJobPct: 0 });
    }),

  onProgress: (jobId: string, pct: number) => {
    if (get().activeJobId === jobId) {
      set({ activeJobPct: pct });
    }
  },

  onDone: (jobId: string, treeId: string) => {
    const pending = _pending.get(jobId);
    if (pending) {
      _pending.delete(jobId);
      set({ activeJobId: null, activeJobPct: 0 });
      pending.resolve(treeId);
    }
  },

  onFailed: (jobId: string, error: string) => {
    const pending = _pending.get(jobId);
    if (pending) {
      _pending.delete(jobId);
      set({ activeJobId: null, activeJobPct: 0 });
      pending.reject(new Error(error));
    }
  },
}));
