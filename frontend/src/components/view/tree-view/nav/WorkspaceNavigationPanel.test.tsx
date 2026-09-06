import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { useWorkspaceNavStore } from "@/hooks/useWorkspaceNavStore";
import { SavedViewDB } from "@/types/savedView";
import { WorkspaceNavigationPanel } from "./WorkspaceNavigationPanel";

// jsdom doesn't implement matchMedia; useIsMobile needs it to mount.
beforeEach(() => {
  window.matchMedia ??= vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

function makeView(overrides: Partial<SavedViewDB> = {}): SavedViewDB {
  return {
    id: "v1",
    workspace_id: "tree-1",
    owner_id: "u1",
    name: "My view",
    focus_member_id: "new-focus",
    section_ids: [],
    ancestor_depth: 3,
    descendant_depth: 3,
    include_partners: true,
    filters: {},
    config_version: 1,
    version: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    last_opened: null,
    positions: [],
    ...overrides,
  };
}

describe("WorkspaceNavigationPanel — saved view create/edit focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSectionStore.setState({ sections: [], initialized: true });
    useSavedViewStore.setState({ views: [], initialized: true });
    useWorkspaceNavStore.getState().clear();
    useMemberStore.setState({
      members: [],
      focusRootId: null,
      focusSectionIds: null,
      setFocusRoot: vi.fn().mockResolvedValue(undefined),
      focusSection: vi.fn().mockResolvedValue(undefined),
      exitFocus: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("focuses a newly created view's focus member even though the store's list hasn't caught up yet", async () => {
    // The mocked action resolves with the new view but — deliberately, to
    // reproduce the stale-closure bug — never adds it to `views`, standing
    // in for the render that hasn't happened yet when onSaved fires.
    const created = makeView({ id: "v2", focus_member_id: "new-focus" });
    useSavedViewStore.setState({
      createSavedView: vi.fn().mockResolvedValue(created),
    });

    render(
      <WorkspaceNavigationPanel
        workspaceId="tree-1"
        workspaceName="Family"
        canWrite
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create saved view" }));
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "New view" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(useMemberStore.getState().setFocusRoot).toHaveBeenCalledWith(
        "new-focus",
      ),
    );
    expect(useWorkspaceNavStore.getState().selectedSavedViewId).toBe("v2");
  });
});
