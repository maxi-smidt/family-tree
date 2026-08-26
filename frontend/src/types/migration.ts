/** One old-workspace -> current-workspace entry from a v1->v2 migration
 *  report (#997). Only the fields #1012's browser-state remap needs — see
 *  backend app.schemas.migration.MigrationReportOut for the full shape. */
export interface WorkspaceMappingDB {
  source_workspace_id: string;
  target_workspace_id: string;
}

export interface MigrationReportDB {
  id: string;
  workspace_mappings: WorkspaceMappingDB[];
}
