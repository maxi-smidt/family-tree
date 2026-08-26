import { api } from "@/services/api";

/** Mirrors the backend's public, unauthenticated migration status contract
 *  (see backend/app/services/migration/status.py, #1020) — safe to poll
 *  while ordinary API routes are gated during a v2 startup migration. */
export interface MigrationStatus {
  status: "preflight" | "backup" | "migrating" | "validating" | "failed" | "complete";
  run_id: string | null;
  phase_heartbeat_at: string | null;
  failure_code: string | null;
  phase_index: number;
  phase_count: number;
}

/** Focused transport client for the unauthenticated /health/* endpoints. */
export const SystemStatusService = {
  getMigrationStatus(): Promise<MigrationStatus> {
    return api.get<MigrationStatus>("/health/migration");
  },
};
