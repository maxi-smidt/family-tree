import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSavedViewStore } from "./useSavedViewStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { SavedViewDB } from "@/types/savedView";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-views";

function makeTree(id = TREE_ID): Workspace {
  return { id, name: "Saved View Workspace", role: "owner" };
}

function makeView(overrides: Partial<SavedViewDB> = {}): SavedViewDB {
  return {
    id: "v1",
    workspace_id: TREE_ID,
    owner_id: "u1",
    name: "My view",
    focus_member_id: "m1",
    section_ids: ["s1"],
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

beforeEach(() => {
  vi.clearAllMocks();
  useSavedViewStore.setState({ views: [], initialized: false, loading: false });
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useSavedViewStore — refreshSavedViews", () => {
  it("clears views when no tree is selected", async () => {
    useSavedViewStore.setState({ views: [makeView()], initialized: true });

    await useSavedViewStore.getState().refreshSavedViews();

    expect(useSavedViewStore.getState().views).toHaveLength(0);
    expect(WorkspaceService.getSavedViews).not.toHaveBeenCalled();
  });

  it("fetches views from the service", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    vi.mocked(WorkspaceService.getSavedViews).mockResolvedValue([makeView()]);

    await useSavedViewStore.getState().refreshSavedViews();

    expect(WorkspaceService.getSavedViews).toHaveBeenCalledWith(TREE_ID);
    expect(useSavedViewStore.getState().views).toHaveLength(1);
    expect(useSavedViewStore.getState().initialized).toBe(true);
  });
});

describe("useSavedViewStore — createSavedView", () => {
  it("creates a view and appends it to the list without a re-fetch", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    const created = makeView();
    vi.mocked(WorkspaceService.createSavedView).mockResolvedValue(created);

    const result = await useSavedViewStore
      .getState()
      .createSavedView({ name: "My view" });

    expect(WorkspaceService.createSavedView).toHaveBeenCalledWith(TREE_ID, {
      name: "My view",
    });
    expect(result).toBe(created);
    expect(useSavedViewStore.getState().views).toEqual([created]);
    expect(WorkspaceService.getSavedViews).not.toHaveBeenCalled();
  });

  it("throws when no tree is selected", async () => {
    await expect(
      useSavedViewStore.getState().createSavedView({ name: "Orphan" }),
    ).rejects.toThrow();
    expect(WorkspaceService.createSavedView).not.toHaveBeenCalled();
  });
});

describe("useSavedViewStore — updateSavedView", () => {
  it("updates the matching view in place without a re-fetch", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    useSavedViewStore.setState({ views: [makeView(), makeView({ id: "v2" })] });
    const updated = makeView({ name: "Renamed", version: 2 });
    vi.mocked(WorkspaceService.updateSavedView).mockResolvedValue(updated);

    const result = await useSavedViewStore
      .getState()
      .updateSavedView("v1", { name: "Renamed", expected_version: 1 });

    expect(WorkspaceService.updateSavedView).toHaveBeenCalledWith(
      TREE_ID,
      "v1",
      { name: "Renamed", expected_version: 1 },
    );
    expect(result.name).toBe("Renamed");
    expect(useSavedViewStore.getState().views).toEqual([
      updated,
      makeView({ id: "v2" }),
    ]);
    expect(WorkspaceService.getSavedViews).not.toHaveBeenCalled();
  });

  it("propagates a stale-conflict rejection and leaves the list untouched", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    useSavedViewStore.setState({ views: [makeView()] });
    const conflict = Object.assign(new Error("stale"), { status: 409 });
    vi.mocked(WorkspaceService.updateSavedView).mockRejectedValue(conflict);

    await expect(
      useSavedViewStore
        .getState()
        .updateSavedView("v1", { name: "Renamed", expected_version: 1 }),
    ).rejects.toBe(conflict);
    expect(useSavedViewStore.getState().views).toEqual([makeView()]);
  });
});

describe("useSavedViewStore — deleteSavedView", () => {
  it("removes the view from the list without a re-fetch", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    useSavedViewStore.setState({ views: [makeView(), makeView({ id: "v2" })] });
    vi.mocked(WorkspaceService.deleteSavedView).mockResolvedValue(undefined);

    await useSavedViewStore.getState().deleteSavedView("v1");

    expect(WorkspaceService.deleteSavedView).toHaveBeenCalledWith(
      TREE_ID,
      "v1",
    );
    expect(useSavedViewStore.getState().views).toEqual([
      makeView({ id: "v2" }),
    ]);
    expect(WorkspaceService.getSavedViews).not.toHaveBeenCalled();
  });
});

describe("useSavedViewStore — duplicateSavedView", () => {
  it("creates a new view carrying over the source's configuration, filters included", async () => {
    useWorkspaceStore.setState({ selectedTree: makeTree() });
    const source = makeView({ filters: { alive: true } });
    vi.mocked(WorkspaceService.createSavedView).mockResolvedValue(
      makeView({ id: "v2", name: "My view (copy)" }),
    );

    await useSavedViewStore
      .getState()
      .duplicateSavedView(source, "My view (copy)");

    expect(WorkspaceService.createSavedView).toHaveBeenCalledWith(TREE_ID, {
      name: "My view (copy)",
      focus_member_id: source.focus_member_id,
      section_ids: source.section_ids,
      ancestor_depth: source.ancestor_depth,
      descendant_depth: source.descendant_depth,
      include_partners: source.include_partners,
      filters: source.filters,
    });
  });
});

describe("useSavedViewStore — clear", () => {
  it("empties the views slice", () => {
    useSavedViewStore.setState({ views: [makeView()], initialized: true });

    useSavedViewStore.getState().clear();

    expect(useSavedViewStore.getState().views).toHaveLength(0);
    expect(useSavedViewStore.getState().initialized).toBe(false);
  });
});
