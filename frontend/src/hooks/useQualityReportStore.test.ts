import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQualityReportStore } from "./useQualityReportStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useMemberStore } from "./useMemberStore";
import { useEventStore } from "./useEventStore";
import { useStoryStore } from "./useStoryStore";
import { useGalleryStore } from "./useGalleryStore";
import { useDocumentStore } from "./useDocumentStore";
import { registerTaskStoreActions } from "./taskStoreRegistry";
import { WorkspaceService } from "@/services/WorkspaceService";
import { QualityReport } from "@/types/quality";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-qr";

function makeTree(): Workspace {
  return { id: TREE_ID, name: "QR Workspace", role: "owner" };
}

const REPORT: QualityReport = {
  workspace_id: TREE_ID,
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
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useQualityReportStore — refreshReport", () => {
  it("clears the report when no tree is selected", async () => {
    useQualityReportStore.setState({ report: REPORT });

    await useQualityReportStore.getState().refreshReport();

    expect(useQualityReportStore.getState().report).toBeNull();
    expect(WorkspaceService.getQualityReport).not.toHaveBeenCalled();
  });

  it("fetches the report from the service", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.getQualityReport).mockResolvedValue(REPORT);

    await useQualityReportStore.getState().refreshReport();

    expect(useQualityReportStore.getState().report).toEqual(REPORT);
  });
});

describe("useQualityReportStore — dismissIssue / restoreIssue", () => {
  it("dismisses an issue then refreshes the report", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.dismissQualityIssue).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getQualityReport).mockResolvedValue({
      ...REPORT,
      issues: [{ ...REPORT.issues[0], dismissed: true }],
    });

    await useQualityReportStore.getState().dismissIssue("issue-1");

    expect(WorkspaceService.dismissQualityIssue).toHaveBeenCalledWith(
      TREE_ID,
      "issue-1",
    );
    expect(useQualityReportStore.getState().report?.issues[0].dismissed).toBe(
      true,
    );
  });

  it("restores an issue then refreshes the report", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.restoreQualityIssue).mockResolvedValue(undefined);
    vi.mocked(WorkspaceService.getQualityReport).mockResolvedValue(REPORT);

    await useQualityReportStore.getState().restoreIssue("issue-1");

    expect(WorkspaceService.restoreQualityIssue).toHaveBeenCalledWith(
      TREE_ID,
      "issue-1",
    );
    expect(useQualityReportStore.getState().report?.issues[0].dismissed).toBe(
      false,
    );
  });

  it("does nothing when no tree is selected", async () => {
    await useQualityReportStore.getState().dismissIssue("issue-1");

    expect(WorkspaceService.dismissQualityIssue).not.toHaveBeenCalled();
  });
});

describe("useQualityReportStore — mergeMembers", () => {
  it("refreshes members and any already-initialized domain stores (#812)", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    useQualityReportStore.setState({ report: REPORT, showDismissed: true });
    vi.mocked(WorkspaceService.mergeMembers).mockResolvedValue(
      {} as Awaited<ReturnType<typeof WorkspaceService.mergeMembers>>,
    );
    vi.mocked(WorkspaceService.getQualityReport).mockResolvedValue(REPORT);

    const refreshMembers = vi.fn().mockResolvedValue(undefined);
    useMemberStore.setState({ refreshMembers });
    const refreshEvents = vi.fn().mockResolvedValue(undefined);
    useEventStore.setState({ initialized: true, refreshEvents });
    const refreshStories = vi.fn().mockResolvedValue(undefined);
    useStoryStore.setState({ initialized: false, refreshStories });
    const refreshGalleryImages = vi.fn().mockResolvedValue(undefined);
    useGalleryStore.setState({ initialized: true, refreshGalleryImages });
    const refreshDocuments = vi.fn().mockResolvedValue(undefined);
    useDocumentStore.setState({ initialized: true, refreshDocuments });
    // Research tasks go through the lazy taskStoreRegistry bridge (like
    // every other post-mutation task refresh in the app) rather than a
    // direct useTaskStore import, so unrelated tests never trigger the
    // real store's own network calls just by importing this one.
    const taskRefresh = vi.fn();
    registerTaskStoreActions({ clear: vi.fn(), refresh: taskRefresh });

    await useQualityReportStore.getState().mergeMembers("keep", "remove", {});

    expect(WorkspaceService.mergeMembers).toHaveBeenCalledWith(TREE_ID, {
      keep_id: "keep",
      remove_id: "remove",
      fields: {},
    });
    expect(refreshMembers).toHaveBeenCalledWith(TREE_ID);
    // Already-hydrated domain stores refresh so they don't keep serving
    // pre-merge data for the rest of the session.
    expect(refreshEvents).toHaveBeenCalledWith(TREE_ID);
    expect(refreshGalleryImages).toHaveBeenCalledWith(TREE_ID);
    expect(refreshDocuments).toHaveBeenCalledWith(TREE_ID);
    expect(taskRefresh).toHaveBeenCalledWith(TREE_ID);
    // A store nobody has opened yet is left uninitialized rather than
    // eagerly hydrated.
    expect(refreshStories).not.toHaveBeenCalled();
    // The report itself ends up fresh, not stuck at the cleared/null state
    // invalidateDerivedViews() briefly sets it to.
    expect(useQualityReportStore.getState().report).toEqual(REPORT);
  });

  it("does nothing when no tree is selected", async () => {
    await useQualityReportStore.getState().mergeMembers("keep", "remove", {});
    expect(WorkspaceService.mergeMembers).not.toHaveBeenCalled();
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
