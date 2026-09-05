import { api } from "@/services/api";
import {
  GrantWidenResult,
  MigrationConflictDB,
  MigrationConflictResolveRequest,
  MigrationReportDB,
} from "@/types/migration";

/** Thin HTTP client for the post-migration report/review API (#991). Stores
 *  call these; components don't. */
export const MigrationService = {
  listReports(): Promise<MigrationReportDB[]> {
    return api
      .get<{ reports: MigrationReportDB[] }>("/migration/reports")
      .then((r) => r.reports);
  },

  acknowledgeReport(reportId: string): Promise<MigrationReportDB> {
    return api.post<MigrationReportDB>(
      `/migration/reports/${reportId}/acknowledge`,
      {},
    );
  },

  widenGrant(
    reportId: string,
    sectionId: string,
    userId: string,
  ): Promise<GrantWidenResult> {
    return api.post<GrantWidenResult>(
      `/migration/reports/${reportId}/widen-grant`,
      { section_id: sectionId, user_id: userId },
    );
  },

  listConflicts(): Promise<MigrationConflictDB[]> {
    return api
      .get<{ conflicts: MigrationConflictDB[] }>("/migration/conflicts")
      .then((r) => r.conflicts);
  },

  resolveConflict(
    conflictId: string,
    payload: MigrationConflictResolveRequest,
  ): Promise<MigrationConflictDB> {
    return api.post<MigrationConflictDB>(
      `/migration/conflicts/${conflictId}/resolve`,
      payload,
    );
  },
};
