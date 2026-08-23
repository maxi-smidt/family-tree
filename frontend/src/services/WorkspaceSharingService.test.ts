import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { WorkspaceSharingService } from "@/services/WorkspaceSharingService";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceSharingService", () => {
  it("loads access members and share candidates for a tree", async () => {
    const access = [
      { user_id: "owner", username: "owner", role: "owner" as const },
      { user_id: "viewer", username: "viewer", role: "viewer" as const },
    ];
    const candidates = [{ user_id: "editor", username: "editor" }];

    vi.mocked(api.get)
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce(candidates);

    await expect(WorkspaceSharingService.getSharingData("tree-1")).resolves.toEqual({
      access,
      candidates,
    });
    expect(api.get).toHaveBeenNthCalledWith(1, "/workspaces/tree-1/access");
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      "/workspaces/tree-1/access/candidates",
    );
  });

  it("centralizes share mutations behind named methods", async () => {
    vi.mocked(api.post).mockResolvedValue([]);
    vi.mocked(api.del).mockResolvedValue(undefined);

    await WorkspaceSharingService.grantAccess("tree-1", "ada", "editor");
    await WorkspaceSharingService.revokeAccess("tree-1", "user-2");
    await WorkspaceSharingService.transferOwnership("tree-1", "grace");

    expect(api.post).toHaveBeenNthCalledWith(1, "/workspaces/tree-1/access", {
      username: "ada",
      role: "editor",
    });
    expect(api.del).toHaveBeenCalledWith("/workspaces/tree-1/access/user-2");
    expect(api.post).toHaveBeenNthCalledWith(2, "/workspaces/tree-1/transfer", {
      username: "grace",
      retain_role: null,
    });
  });
});
