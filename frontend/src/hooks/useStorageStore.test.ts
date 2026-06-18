import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorageStore } from "./useStorageStore";
import { useTreeStore } from "./useTreeStore";
import { TreeService } from "@/services/TreeService";
import { TreeStorageUsageDB } from "@/types/storage";
import { Tree } from "@/types/tree";

vi.mock("@/services/TreeService");

const TREE_ID = "tree-storage-test";
const TREE: Tree = { id: TREE_ID, name: "Storage Tree", role: "owner" };

const USAGE: TreeStorageUsageDB = {
  tree_bytes: 1024,
  media_bytes: 2048,
  total_bytes: 3072,
  tree_quota_bytes: 10240,
  media_quota_bytes: null,
  total_quota_bytes: 20480,
};

beforeEach(() => {
  vi.clearAllMocks();
  useStorageStore.setState({ usage: null, isLoading: false });
  useTreeStore.setState({ selectedTree: undefined });
});

describe("useStorageStore — refreshStorageUsage", () => {
  it("clears usage and skips the API when no tree is selected", async () => {
    useStorageStore.setState({ usage: USAGE });

    await useStorageStore.getState().refreshStorageUsage();

    expect(useStorageStore.getState().usage).toBeNull();
    expect(TreeService.getStorageUsage).not.toHaveBeenCalled();
  });

  it("fetches usage for the given treeId and stores it", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getStorageUsage).mockResolvedValue(USAGE);

    await useStorageStore.getState().refreshStorageUsage(TREE_ID);

    expect(TreeService.getStorageUsage).toHaveBeenCalledWith(TREE_ID);
    const stored = useStorageStore.getState().usage;
    expect(stored).not.toBeNull();
    expect(stored?.tree_bytes).toBe(1024);
    expect(stored?.media_bytes).toBe(2048);
    expect(stored?.total_bytes).toBe(3072);
  });

  it("handles null quota fields (unlimited)", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    const unlimitedUsage: TreeStorageUsageDB = {
      ...USAGE,
      tree_quota_bytes: null,
      media_quota_bytes: null,
      total_quota_bytes: null,
    };
    vi.mocked(TreeService.getStorageUsage).mockResolvedValue(unlimitedUsage);

    await useStorageStore.getState().refreshStorageUsage(TREE_ID);

    const stored = useStorageStore.getState().usage;
    expect(stored?.tree_quota_bytes).toBeNull();
    expect(stored?.media_quota_bytes).toBeNull();
    expect(stored?.total_quota_bytes).toBeNull();
  });

  it("sets isLoading to true during fetch and false after", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    let capturedLoading = false;
    vi.mocked(TreeService.getStorageUsage).mockImplementation(async () => {
      capturedLoading = useStorageStore.getState().isLoading;
      return USAGE;
    });

    await useStorageStore.getState().refreshStorageUsage(TREE_ID);

    expect(capturedLoading).toBe(true);
    expect(useStorageStore.getState().isLoading).toBe(false);
  });

  it("sets error and resets isLoading when the API throws (no rejection)", async () => {
    useTreeStore.setState({ selectedTree: TREE });
    vi.mocked(TreeService.getStorageUsage).mockRejectedValue(
      new Error("network error"),
    );

    // Must resolve, not reject — the store swallows the failure into an error flag.
    await expect(
      useStorageStore.getState().refreshStorageUsage(TREE_ID),
    ).resolves.toBeUndefined();

    expect(useStorageStore.getState().error).toBe(true);
    expect(useStorageStore.getState().isLoading).toBe(false);
  });
});

describe("useStorageStore — clear", () => {
  it("resets usage to null", () => {
    useStorageStore.setState({ usage: USAGE });

    useStorageStore.getState().clear();

    expect(useStorageStore.getState().usage).toBeNull();
  });
});
