import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useQualityReportStore } from "@/hooks/useQualityReportStore";
import { useTaskStore } from "@/hooks/useTaskStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { QualityReportView } from "./QualityReportView";

describe("QualityReportView research tasks", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useAuthStore.setState({ features: ["research_tasks"] });
    useTreeStore.setState({
      selectedTree: { id: "tree-1", role: "owner" } as never,
    });
    useMemberStore.setState({
      members: [
        {
          id: "member-1",
          firstName: "Ada",
          lastName: "Lovelace",
          date: { birth: null, death: null },
        },
      ] as never,
    });
    useTaskStore.setState({
      tasks: [
        {
          id: "task-1",
          linkedMemberIds: ["member-1"],
          title: "Find birth record",
          notes: "",
          done: false,
          createdAt: "2026-01-01T00:00:00Z",
          doneAt: null,
        },
      ],
      initialized: true,
      refreshTasks: vi.fn(),
      setTaskDone: vi.fn(),
    });
    useQualityReportStore.setState({
      report: { issues: [] } as never,
      isLoading: false,
      refreshReport: vi.fn(),
    });
    useMemberSheetStore.setState({ openSheets: {}, setOpenSheet: vi.fn() });
    useNavigationStore.setState({ navigateTo: vi.fn(), pendingView: null });
  });

  it("opens the linked member from an open research task", () => {
    render(<QualityReportView />);

    fireEvent.click(screen.getByRole("button", { name: "Ada Lovelace" }));

    expect(useMemberSheetStore.getState().setOpenSheet).toHaveBeenCalledWith(
      "tree-1",
      { memberId: "member-1", tab: "records", mode: "view" },
    );
    expect(useNavigationStore.getState().navigateTo).toHaveBeenCalledWith(
      "tree-view",
    );
  });

  it("offers a tree-wide task without selecting a person", () => {
    useTaskStore.setState({ tasks: [] });

    render(<QualityReportView />);

    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", {
        name: "Multi-select: 0 of 1 options selected. Select members...",
      }),
    ).toBeInTheDocument();
  });
});
