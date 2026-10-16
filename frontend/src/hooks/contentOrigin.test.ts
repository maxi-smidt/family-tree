import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentOriginArgs } from "./contentOrigin";
import { useMemberStore } from "./useMemberStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useEventStore } from "./useEventStore";
import { WorkspaceService } from "@/services/WorkspaceService";

vi.mock("@/services/WorkspaceService");

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    selectedTree: { id: "workspace", name: "Family", role: "owner" },
  });
  useMemberStore.getState().clear();
  vi.mocked(WorkspaceService.getEvents).mockResolvedValue([]);
  vi.mocked(WorkspaceService.getEventMemberLinks).mockResolvedValue([]);
});

describe("content creation origin", () => {
  it("passes the selected section from the store to event creation", async () => {
    useMemberStore.setState({ focusSectionIds: ["private-section"] });
    await useEventStore.getState().addEvent(["private-member"], {
      eventType: "birth",
      date: "2000",
      location: null,
      description: "Private",
    });
    expect(WorkspaceService.addEvent).toHaveBeenCalledWith(
      "workspace",
      expect.any(String),
      expect.objectContaining({ description: "Private" }),
      expect.any(String),
      ["private-member"],
      "private-section",
    );
  });

  it("refuses an ambiguous multi-section origin before creating content", async () => {
    useMemberStore.setState({ focusSectionIds: ["a", "b"] });
    await expect(
      useEventStore.getState().addEvent([], {
        eventType: "birth",
        date: "2000",
        location: null,
        description: null,
      }),
    ).rejects.toThrow();
    expect(WorkspaceService.addEvent).not.toHaveBeenCalled();
  });

  it("does not reuse a section for a different workspace", () => {
    useMemberStore.setState({ focusSectionIds: ["private-section"] });
    expect(contentOriginArgs("other-workspace")).toEqual([]);
  });
});
