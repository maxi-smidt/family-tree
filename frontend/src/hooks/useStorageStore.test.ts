import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorageStore } from "./useStorageStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { WorkspaceService } from "@/services/WorkspaceService";
import { WorkspaceStorageUsageDB } from "@/types/storage";
import { Workspace } from "@/types/workspace";

vi.mock("@/services/WorkspaceService");

const TREE_ID = "tree-storage-test";
const TREE: Workspace = { id: TREE_ID, name: "Storage Workspace", role: "owner" };

const USAGE: WorkspaceStorageUsageDB = {
  tree_bytes: 1024,
  media_bytes: 2048,
  total_bytes: 3072,
  tree_quota_bytes: 10240,
  media_quota_bytes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useStorageStore.setState({ usage: null, isLoading: false });
  useWorkspaceStore.setState({ selectedTree: undefined });
});

describe("useStorageStore — refreshStorageUsage", () => {
  it("clears usage and skips the API when no tree is selected", async () => {
    useStorageStore.setState({ usage: USAGE });

    await useStorageStore.getState().refreshStorageUsage();

    expect(useStorageStore.getState().usage).toBeNull();
    expect(WorkspaceService.getStorageUsage).not.toHaveBeenCalled();
  });

  it("fetches usage for the given workspaceId and stores it", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getStorageUsage).mockResolvedValue(USAGE);

    await useStorageStore.getState().refreshStorageUsage(TREE_ID);

    expect(WorkspaceService.getStorageUsage).toHaveBeenCalledWith(TREE_ID);
    const stored = useStorageStore.getState().usage;
    expect(stored).not.toBeNull();
    expect(stored?.tree_bytes).toBe(1024);
    expect(stored?.media_bytes).toBe(2048);
    expect(stored?.total_bytes).toBe(3072);
  });

  it("handles null quota fields (unlimited)", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    const unlimitedUsage: WorkspaceStorageUsageDB = {
      ...USAGE,
      tree_quota_bytes: null,
      media_quota_bytes: null,
    };
    vi.mocked(WorkspaceService.getStorageUsage).mockResolvedValue(unlimitedUsage);

    await useStorageStore.getState().refreshStorageUsage(TREE_ID);

    const stored = useStorageStore.getState().usage;
    expect(stored?.tree_quota_bytes).toBeNull();
    expect(stored?.media_quota_bytes).toBeNull();
  });

  it("sets isLoading to true during fetch and false after", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    let capturedLoading = false;
    vi.mocked(WorkspaceService.getStorageUsage).mockImplementation(async () => {
      capturedLoading = useStorageStore.getState().isLoading;
      return USAGE;
    });

    await useStorageStore.getState().refreshStorageUsage(TREE_ID);

    expect(capturedLoading).toBe(true);
    expect(useStorageStore.getState().isLoading).toBe(false);
  });

  it("sets error and resets isLoading when the API throws (no rejection)", async () => {
    useWorkspaceStore.setState({ selectedTree: TREE });
    vi.mocked(WorkspaceService.getStorageUsage).mockRejectedValue(
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
