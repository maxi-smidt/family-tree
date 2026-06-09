export interface QualityIssue {
  issue_type: string;
  severity: "error" | "warning";
  member_ids: string[];
  description: string;
}

export interface QualityReport {
  tree_id: string;
  total_members: number;
  issues: QualityIssue[];
}
