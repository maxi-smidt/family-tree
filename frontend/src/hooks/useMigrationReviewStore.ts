import { create } from "zustand";
import { MigrationService } from "@/services/MigrationService";
import {
  GrantWidenResult,
  MigrationConflictDB,
  MigrationConflictResolveRequest,
  MigrationReportDB,
} from "@/types/migration";

interface MigrationReviewState {
  reports: MigrationReportDB[];
  conflicts: MigrationConflictDB[];
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  acknowledgeReport: (reportId: string) => Promise<void>;
  widenGrant: (
    reportId: string,
    sectionId: string,
    userId: string,
  ) => Promise<GrantWidenResult>;
  resolveConflict: (
    conflictId: string,
    payload: MigrationConflictResolveRequest,
  ) => Promise<void>;
}

export const useMigrationReviewStore = create<MigrationReviewState>(
  (set, get) => ({
    reports: [],
    conflicts: [],
    loading: false,
    loaded: false,

    load: async () => {
      set({ loading: true });
      try {
        const [reports, conflicts] = await Promise.all([
          MigrationService.listReports(),
          MigrationService.listConflicts(),
        ]);
        set({ reports, conflicts, loaded: true });
      } finally {
        set({ loading: false });
      }
    },

    acknowledgeReport: async (reportId) => {
      const updated = await MigrationService.acknowledgeReport(reportId);
      set({
        reports: get().reports.map((r) => (r.id === reportId ? updated : r)),
      });
    },

    widenGrant: async (reportId, sectionId, userId) => {
      const result = await MigrationService.widenGrant(
        reportId,
        sectionId,
        userId,
      );
      // The report's own grant_changes rows are immutable history — reload
      // it so a second widen attempt on the same pair 404s instead of
      // re-offering an action that no longer applies.
      await get().load();
      return result;
    },

    resolveConflict: async (conflictId, payload) => {
      const updated = await MigrationService.resolveConflict(
        conflictId,
        payload,
      );
      set({
        conflicts: get().conflicts.map((c) =>
          c.id === conflictId ? updated : c,
        ),
      });
    },
  }),
);

/** Reactive selector for a tab/nav badge: reports awaiting acknowledgement
 *  plus conflicts still pending review. */
export const usePendingMigrationReviewCount = (): number =>
  useMigrationReviewStore(
    (s) =>
      s.reports.filter((r) => r.status !== "acknowledged").length +
      s.conflicts.filter((c) => c.status === "pending").length,
  );
