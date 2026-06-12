import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { TreeSharingService } from "@/services/TreeSharingService";

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

describe("TreeSharingService", () => {
  it("loads access members and share candidates for a tree", async () => {
    const access = [
      { user_id: "owner", username: "owner", role: "owner" as const },
      { user_id: "viewer", username: "viewer", role: "viewer" as const },
    ];
    const candidates = [{ user_id: "editor", username: "editor" }];

    vi.mocked(api.get)
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce(candidates);

    await expect(TreeSharingService.getSharingData("tree-1")).resolves.toEqual({
      access,
      candidates,
    });
    expect(api.get).toHaveBeenNthCalledWith(1, "/trees/tree-1/access");
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      "/trees/tree-1/access/candidates",
    );
  });

  it("centralizes share mutations behind named methods", async () => {
    vi.mocked(api.post).mockResolvedValue([]);
    vi.mocked(api.del).mockResolvedValue(undefined);

    await TreeSharingService.grantAccess("tree-1", "ada", "editor");
    await TreeSharingService.revokeAccess("tree-1", "user-2");
    await TreeSharingService.transferOwnership("tree-1", "grace");

    expect(api.post).toHaveBeenNthCalledWith(1, "/trees/tree-1/access", {
      username: "ada",
      role: "editor",
    });
    expect(api.del).toHaveBeenCalledWith("/trees/tree-1/access/user-2");
    expect(api.post).toHaveBeenNthCalledWith(2, "/trees/tree-1/transfer", {
      username: "grace",
    });
  });
});
