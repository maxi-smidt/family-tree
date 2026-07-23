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

type ActivityPage = Awaited<ReturnType<typeof TreeService.getActivity>>;

// A promise whose settlement we control, so a test can force responses to
// arrive out of order relative to the order the requests were issued.
function deferred() {
  let resolve!: (value: ActivityPage) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<ActivityPage>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  it("ignores a stale page response that settles after a newer page request", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(TreeService.getActivity)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useActivityStore.getState().setPage(1);
    const p2 = useActivityStore.getState().setPage(2);

    // The newer request (page 2) resolves first and is applied.
    second.resolve(page(["p2"], 100));
    await p2;
    expect(useActivityStore.getState()).toMatchObject({
      page: 2,
      loading: false,
      activities: [{ id: "p2" }],
    });

    // The superseded page-1 response arrives late and must be discarded.
    first.resolve(page(["p1"], 100));
    await p1;
    expect(useActivityStore.getState()).toMatchObject({
      page: 2,
      activities: [{ id: "p2" }],
    });
  });

  it("keeps loading while a stale response settles before the newest page-size request", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(TreeService.getActivity)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useActivityStore.getState().setPageSize(10);
    const p2 = useActivityStore.getState().setPageSize(50);
    expect(useActivityStore.getState().loading).toBe(true);

    // The stale response settles first; loading must stay tied to the latest request.
    first.resolve(page(["stale"], 1));
    await p1;
    expect(useActivityStore.getState().loading).toBe(true);

    second.resolve(page(["fresh"], 1));
    await p2;
    expect(useActivityStore.getState()).toMatchObject({
      loading: false,
      pageSize: 50,
      activities: [{ id: "fresh" }],
    });
  });

  it("ignores a stale response when the actor filter changes rapidly", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(TreeService.getActivity)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useActivityStore.getState().setFilter("filterActor", "Ada");
    const p2 = useActivityStore.getState().setFilter("filterActor", "Bob");

    second.resolve(page(["bob"], 5, ["Ada", "Bob"]));
    await p2;
    first.resolve(page(["ada"], 9, ["Ada", "Bob"]));
    await p1;

    expect(useActivityStore.getState()).toMatchObject({
      filterActor: "Bob",
      total: 5,
      activities: [{ id: "bob" }],
    });
  });

  it("ignores a stale response when the action filter changes rapidly", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(TreeService.getActivity)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useActivityStore.getState().setFilter("filterAction", "create");
    const p2 = useActivityStore.getState().setFilter("filterAction", "delete");

    second.resolve(page(["del"], 2));
    await p2;
    first.resolve(page(["cre"], 7));
    await p1;

    expect(useActivityStore.getState()).toMatchObject({
      filterAction: "delete",
      total: 2,
      activities: [{ id: "del" }],
    });
  });

  it("ignores a stale response when the target-type filter changes rapidly", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(TreeService.getActivity)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useActivityStore
      .getState()
      .setFilter("filterTargetType", "member");
    const p2 = useActivityStore
      .getState()
      .setFilter("filterTargetType", "document");

    // The newest request carries the newly supported "document" target type.
    expect(TreeService.getActivity).toHaveBeenLastCalledWith(
      "tree-1",
      expect.objectContaining({ target_type: "document" }),
    );

    second.resolve(page(["doc"], 3));
    await p2;
    first.resolve(page(["mem"], 8));
    await p1;

    expect(useActivityStore.getState()).toMatchObject({
      filterTargetType: "document",
      total: 3,
      activities: [{ id: "doc" }],
    });
  });

  it("does not let a stale failure overwrite a newer successful response", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(TreeService.getActivity)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const p1 = useActivityStore.getState().setPage(1);
    const p2 = useActivityStore.getState().setPage(2);

    second.resolve(page(["fresh"], 4));
    await p2;

    // The superseded request rejects late; its error must be swallowed.
    first.reject(new Error("stale offline"));
    await p1;

    expect(useActivityStore.getState()).toMatchObject({
      error: null,
      loading: false,
      page: 2,
      activities: [{ id: "fresh" }],
    });
  });

  describe("undo", () => {
    const report = {
      undo_entry_id: "u1",
      target_type: "member",
      restored: { member: "m1" },
      skipped: [],
    };

    it("calls the service with the active tree and entry id, then refreshes", async () => {
      vi.mocked(TreeService.undoActivity).mockResolvedValue(report);
      vi.mocked(TreeService.getActivity).mockResolvedValue(page(["a1"], 1));

      const result = await useActivityStore.getState().undo("entry-1");

      expect(TreeService.undoActivity).toHaveBeenCalledWith("tree-1", "entry-1");
      expect(TreeService.getActivity).toHaveBeenCalled();
      expect(result).toEqual(report);
    });

    it("propagates a rejection so the caller can report it", async () => {
      vi.mocked(TreeService.undoActivity).mockRejectedValue(new Error("conflict"));

      await expect(
        useActivityStore.getState().undo("entry-1"),
      ).rejects.toThrow("conflict");
    });
  });
});
