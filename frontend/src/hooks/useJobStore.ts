import { create } from "zustand";
import { api } from "@/services/api";

interface PendingJob {
  resolve: (workspaceId: string) => void;
  reject: (err: Error) => void;
}

interface EarlyResult {
  workspaceId?: string;
  error?: string;
}

// Module-level maps so mutations don't trigger spurious re-renders.
const _pending = new Map<string, PendingJob>();
// Stash job.done / job.failed events that arrived before trackJob was called.
const _early = new Map<string, EarlyResult>();

interface JobStoreState {
  activeJobId: string | null;
  activeJobPct: number;

  /** Register a job and return a Promise that resolves with its result_workspace_id. */
  trackJob: (jobId: string) => Promise<string>;
  onProgress: (jobId: string, pct: number) => void;
  onDone: (jobId: string, workspaceId: string) => void;
  onFailed: (jobId: string, error: string) => void;
}

export const useJobStore = create<JobStoreState>((set) => ({
  activeJobId: null,
  activeJobPct: 0,

  trackJob: (jobId: string) =>
    new Promise<string>((resolve, reject) => {
      // The SSE job.done/job.failed event may have arrived before trackJob was
      // called (race condition for very fast jobs). Check the stash first.
      const early = _early.get(jobId);
      if (early) {
        _early.delete(jobId);
        if (early.workspaceId !== undefined) {
          resolve(early.workspaceId);
        } else {
          reject(new Error(early.error ?? "Job failed"));
        }
        return;
      }

      // Guard against double-resolution from simultaneous SSE + poll paths.
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      _pending.set(jobId, {
        resolve: (workspaceId: string) => settle(() => resolve(workspaceId)),
        reject: (err: Error) => settle(() => reject(err)),
      });
      set({ activeJobId: jobId, activeJobPct: 0 });

      // Polling fallback — resolves the promise when SSE is unavailable
      // (e.g. aborted in E2E tests or dropped by a proxy).
      void (async () => {
        for (;;) {
          await new Promise<void>((r) => setTimeout(r, 2000));
          if (settled) break;
          try {
            const job = await api.get<{
              status: string;
              result_workspace_id?: string;
              error?: string;
            }>(`/jobs/${jobId}`);
            if (job.status === "done" && job.result_workspace_id) {
              settle(() => {
                _pending.delete(jobId);
                set({ activeJobId: null, activeJobPct: 0 });
                resolve(job.result_workspace_id!);
              });
            } else if (job.status === "failed") {
              settle(() => {
                _pending.delete(jobId);
                set({ activeJobId: null, activeJobPct: 0 });
                reject(new Error(job.error ?? "Job failed"));
              });
            }
          } catch {
            // ignore transient errors, keep polling
          }
        }
      })();
    }),

  onProgress: (jobId: string, pct: number) => {
    set((s) => (s.activeJobId === jobId ? { activeJobPct: pct } : {}));
  },

  onDone: (jobId: string, workspaceId: string) => {
    const pending = _pending.get(jobId);
    if (pending) {
      _pending.delete(jobId);
      set({ activeJobId: null, activeJobPct: 0 });
      pending.resolve(workspaceId);
    } else {
      // trackJob hasn't been called yet — stash the result.
      _early.set(jobId, { workspaceId });
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
