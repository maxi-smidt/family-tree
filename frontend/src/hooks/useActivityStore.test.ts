import { beforeEach, describe, expect, it, vi } from "vitest";
import { TreeService } from "@/services/TreeService";

vi.mock("@/services/TreeService");
vi.mock("@/hooks/useTreeStore", () => ({
  activeTreeId: () => "tree-1",
  isActiveTree: (treeId: string) => treeId === "tree-1",
}));

import { useActivityStore } from "./useActivityStore";

function page(ids: string[], total: number, actors: string[] = ["Ada"]) {
  return {
    entries: ids.map((id) => ({
      id,
      tree_id: "tree-1",
      actor_id: null,
      actor_username: "Ada",
      action: "create",
      target_type: "member",
      target_id: "m1",
      target_label: "Ada Doe",
      created_at: "2026-01-01T00:00:00+00:00",
      details: null,
    })),
    total,
    actors,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useActivityStore.getState().clear();
});

describe("useActivityStore", () => {
  it("loads the first page with total and the full actor list", async () => {
    vi.mocked(TreeService.getActivity).mockResolvedValue(
      page(["a2", "a1"], 2, ["Ada", "Bob"]),
    );

    await useActivityStore.getState().refreshActivity();

    expect(TreeService.getActivity).toHaveBeenLastCalledWith("tree-1", {
      offset: 0,
      limit: 25,
      actor: undefined,
      action: undefined,
      target_type: undefined,
    });
    expect(useActivityStore.getState()).toMatchObject({
      page: 0,
      total: 2,
      actors: ["Ada", "Bob"],
      initialized: true,
      activities: [{ id: "a2" }, { id: "a1" }],
    });
  });

  it("requests the right offset when paging and resets to page 0 on resize", async () => {
    vi.mocked(TreeService.getActivity).mockResolvedValue(page(["a1"], 60));

    await useActivityStore.getState().refreshActivity();
    await useActivityStore.getState().setPage(2);
    expect(TreeService.getActivity).toHaveBeenLastCalledWith(
      "tree-1",
      expect.objectContaining({ offset: 50, limit: 25 }),
    );

    await useActivityStore.getState().setPageSize(50);
    expect(useActivityStore.getState().page).toBe(0);
    expect(TreeService.getActivity).toHaveBeenLastCalledWith(
      "tree-1",
      expect.objectContaining({ offset: 0, limit: 50 }),
    );
  });

  it("sends active filters to the server and returns to the first page", async () => {
    vi.mocked(TreeService.getActivity).mockResolvedValue(page(["a1"], 1));

    await useActivityStore.getState().refreshActivity();
    await useActivityStore.getState().setPage(3);
    await useActivityStore.getState().setFilter("filterAction", "update");

    expect(useActivityStore.getState().page).toBe(0);
    expect(TreeService.getActivity).toHaveBeenLastCalledWith(
      "tree-1",
      expect.objectContaining({ offset: 0, action: "update" }),
    );
  });

  it("keeps the previous state retryable after a failed load", async () => {
    vi.mocked(TreeService.getActivity)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page(["a1"], 1));

    await useActivityStore.getState().refreshActivity();
    expect(useActivityStore.getState()).toMatchObject({
      initialized: false,
      loading: false,
      error: "Error: offline",
    });

    await useActivityStore.getState().retry();
    expect(useActivityStore.getState()).toMatchObject({
      initialized: true,
      loading: false,
      error: null,
      activities: [{ id: "a1" }],
    });
  });
});
