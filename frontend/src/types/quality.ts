export interface QualityIssue {
  id: string;
  issue_type: string;
  severity: "error" | "warning";
  member_ids: string[];
  description: string;
  dismissed: boolean;
}

export interface QualityReport {
  tree_id: string;
  total_members: number;
  issues: QualityIssue[];
}
