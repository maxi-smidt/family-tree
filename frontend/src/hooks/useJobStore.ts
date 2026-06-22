import { create } from "zustand";

interface PendingJob {
  resolve: (treeId: string) => void;
  reject: (err: Error) => void;
}

interface EarlyResult {
  treeId?: string;
  error?: string;
}

// Module-level maps so mutations don't trigger spurious re-renders.
const _pending = new Map<string, PendingJob>();
// Stash job.done / job.failed events that arrived before trackJob was called.
const _early = new Map<string, EarlyResult>();

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
      // The SSE job.done/job.failed event may have arrived before trackJob was
      // called (race condition for very fast jobs). Check the stash first.
      const early = _early.get(jobId);
      if (early) {
        _early.delete(jobId);
        if (early.treeId !== undefined) {
          resolve(early.treeId);
        } else {
          reject(new Error(early.error ?? "Job failed"));
        }
        return;
      }
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
    } else {
      // trackJob hasn't been called yet — stash the result.
      _early.set(jobId, { treeId });
    }
  },

  onFailed: (jobId: string, error: string) => {
    const pending = _pending.get(jobId);
    if (pending) {
      _pending.delete(jobId);
      set({ activeJobId: null, activeJobPct: 0 });
      pending.reject(new Error(error));
    } else {
      // trackJob hasn't been called yet — stash the error.
      _early.set(jobId, { error });
    }
  },
}));
