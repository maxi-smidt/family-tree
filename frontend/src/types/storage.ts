/** Per-tree storage usage and quota limits returned by GET /trees/{id}/storage */
export interface TreeStorageUsageDB {
  tree_bytes: number;
  media_bytes: number;
  total_bytes: number;
  /** Effective quota for tree-data rows (null = unlimited). */
  tree_quota_bytes: number | null;
  /** Effective quota for on-disk media (null = unlimited). */
  media_quota_bytes: number | null;
  /** Effective quota for total usage (null = unlimited). */
  total_quota_bytes: number | null;
}
