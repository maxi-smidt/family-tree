import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQualityReportStore } from "./useQualityReportStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { QualityReport } from "@/types/quality";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");

const TREE_ID = "tree-qr";

function makeTree(): Tree {
  return { id: TREE_ID, name: "QR Tree", role: "owner" };
}

const REPORT: QualityReport = {
  tree_id: TREE_ID,
  total_members: 2,
  issues: [
    {
      id: "issue-1",
      issue_type: "birth_after_death",
      severity: "error",
      member_ids: ["m1"],
      description: "Birth after death.",
      dismissed: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useQualityReportStore.setState({
    report: null,
    isLoading: false,
    showDismissed: false,
  });
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useQualityReportStore — refreshReport", () => {
  it("clears the report when no tree is selected", async () => {
    useQualityReportStore.setState({ report: REPORT });

    await useQualityReportStore.getState().refreshReport();

    expect(useQualityReportStore.getState().report).toBeNull();
    expect(TreeService.getQualityReport).not.toHaveBeenCalled();
  });

  it("fetches the report from the service", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.getQualityReport).mockResolvedValue(REPORT);

    await useQualityReportStore.getState().refreshReport();

    expect(useQualityReportStore.getState().report).toEqual(REPORT);
  });
});

describe("useQualityReportStore — dismissIssue / restoreIssue", () => {
  it("dismisses an issue then refreshes the report", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.dismissQualityIssue).mockResolvedValue(undefined);
    vi.mocked(TreeService.getQualityReport).mockResolvedValue({
      ...REPORT,
      issues: [{ ...REPORT.issues[0], dismissed: true }],
    });

    await useQualityReportStore.getState().dismissIssue("issue-1");

    expect(TreeService.dismissQualityIssue).toHaveBeenCalledWith(
      TREE_ID,
      "issue-1",
    );
    expect(useQualityReportStore.getState().report?.issues[0].dismissed).toBe(
      true,
    );
  });

  it("restores an issue then refreshes the report", async () => {
    useTreeStore.setState({ selectedTree: makeTree() });
    vi.mocked(TreeService.restoreQualityIssue).mockResolvedValue(undefined);
    vi.mocked(TreeService.getQualityReport).mockResolvedValue(REPORT);

    await useQualityReportStore.getState().restoreIssue("issue-1");

    expect(TreeService.restoreQualityIssue).toHaveBeenCalledWith(
      TREE_ID,
      "issue-1",
    );
    expect(useQualityReportStore.getState().report?.issues[0].dismissed).toBe(
      false,
    );
  });

  it("does nothing when no tree is selected", async () => {
    await useQualityReportStore.getState().dismissIssue("issue-1");

    expect(TreeService.dismissQualityIssue).not.toHaveBeenCalled();
  });
});

describe("useQualityReportStore — setShowDismissed / clear", () => {
  it("toggles showDismissed", () => {
    useQualityReportStore.getState().setShowDismissed(true);
    expect(useQualityReportStore.getState().showDismissed).toBe(true);
  });

  it("clear() resets report and showDismissed", () => {
    useQualityReportStore.setState({ report: REPORT, showDismissed: true });

    useQualityReportStore.getState().clear();

    expect(useQualityReportStore.getState().report).toBeNull();
    expect(useQualityReportStore.getState().showDismissed).toBe(false);
  });
});
