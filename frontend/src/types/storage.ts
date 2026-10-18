/** Owner-wide storage usage and quotas returned by GET /workspaces/{id}/storage. */
export interface WorkspaceStorageUsageDB {
  tree_bytes: number;
  media_bytes: number;
  /** Reported sum of tree + media; has no separate quota. */
  total_bytes: number;
  /** Effective quota for tree-data rows (null = unlimited). */
  tree_quota_bytes: number | null;
  /** Effective quota for on-disk media (null = unlimited). */
  media_quota_bytes: number | null;
}
