import { api } from "@/services/api";
import { MigrationReportDB } from "@/types/migration";

function listReports(): Promise<MigrationReportDB[]> {
  return api
    .get<{ reports: MigrationReportDB[] }>("/migration/reports")
    .then((res) => res.reports);
}

export const MigrationService = {
  listReports(): Promise<MigrationReportDB[]> {
    return listReports();
  },
};
