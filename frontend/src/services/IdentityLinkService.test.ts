import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { IdentityLinkService } from "@/services/IdentityLinkService";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IdentityLinkService", () => {
  it("unwraps the links envelope for a member", async () => {
    vi.mocked(api.get).mockResolvedValue({ links: [{ id: "l1" }] });

    await expect(
      IdentityLinkService.listForMember("w1", "m1"),
    ).resolves.toEqual([{ id: "l1" }]);
    expect(api.get).toHaveBeenCalledWith(
      "/workspaces/w1/members/m1/identity-links",
    );
  });

  it("proposes a link with the target workspace/member ids", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "l1" });

    await IdentityLinkService.propose("w1", "m1", "w2", "m2");

    expect(api.post).toHaveBeenCalledWith(
      "/workspaces/w1/members/m1/identity-links",
      { target_workspace_id: "w2", target_member_id: "m2" },
    );
  });

  it("proposes a claim by username, never a workspace or member id", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "c1" });

    await IdentityLinkService.proposeClaim("w1", "m1", "bob", "maybe my uncle");

    expect(api.post).toHaveBeenCalledWith(
      "/workspaces/w1/members/m1/identity-link-claims",
      { target_username: "bob", note: "maybe my uncle" },
    );
  });

  it("completes a claim against the caller's own chosen workspace/member", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "l1" });

    await IdentityLinkService.completeClaim("c1", "w3", "m3");

    expect(api.post).toHaveBeenCalledWith("/identity-link-claims/c1/complete", {
      workspace_id: "w3",
      member_id: "m3",
    });
  });

  it("cancels a claim without a workspace path segment, so it still works after losing access", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "c1" });

    await IdentityLinkService.cancelClaim("c1");

    expect(api.post).toHaveBeenCalledWith(
      "/identity-link-claims/c1/cancel",
      {},
    );
  });

  it("unwraps the claims envelope for incoming/outgoing listings", async () => {
    vi.mocked(api.get).mockResolvedValue({ claims: [{ id: "c1" }] });

    await expect(IdentityLinkService.listIncomingClaims()).resolves.toEqual([
      { id: "c1" },
    ]);
    expect(api.get).toHaveBeenCalledWith("/identity-link-claims/incoming");
  });
});
