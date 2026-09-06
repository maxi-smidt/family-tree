import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentityLinkStore } from "./useIdentityLinkStore";
import { IdentityLinkService } from "@/services/IdentityLinkService";
import { IdentityLink, IdentityLinkClaim } from "@/types/identityLink";

vi.mock("@/services/IdentityLinkService");

function link(
  id: string,
  status: IdentityLink["status"] = "verified",
): IdentityLink {
  return {
    id,
    status,
    verification_basis: "mutual_consent",
    self: {
      workspace_id: "w1",
      workspace_name: "Mine",
      member_id: "m1",
      display_name: "Ada",
    },
    counterpart: {
      workspace_id: "w2",
      workspace_name: "Theirs",
      member_id: "m2",
      display_name: "Ada Two",
    },
    counterpart_protected: false,
    proposed_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    verified_at: null,
    decided_at: null,
    decision_reason: null,
  };
}

function claim(
  id: string,
  status: IdentityLinkClaim["status"] = "pending",
): IdentityLinkClaim {
  return {
    id,
    status,
    source_workspace_id: "w1",
    source_workspace_name: "Mine",
    source_member_id: "m1",
    source_display_name: "Ada",
    proposer_username: "alice",
    target_username: "bob",
    note: null,
    created_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    decided_at: null,
    decision_reason: null,
    resulting_identity_link_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useIdentityLinkStore.getState().clear();
});

describe("useIdentityLinkStore", () => {
  it("loadForMember populates both links and claims for that member", async () => {
    vi.mocked(IdentityLinkService.listForMember).mockResolvedValue([
      link("l1"),
    ]);
    vi.mocked(IdentityLinkService.listClaimsForMember).mockResolvedValue([
      claim("c1"),
    ]);

    await useIdentityLinkStore.getState().loadForMember("w1", "m1");

    const state = useIdentityLinkStore.getState();
    expect(state.linksByMember["m1"].map((l) => l.id)).toEqual(["l1"]);
    expect(state.claimsByMember["m1"].map((c) => c.id)).toEqual(["c1"]);
  });

  it("propose calls the service then refreshes the member's links", async () => {
    vi.mocked(IdentityLinkService.propose).mockResolvedValue(
      link("l1", "proposed"),
    );
    vi.mocked(IdentityLinkService.listForMember).mockResolvedValue([
      link("l1", "proposed"),
    ]);
    vi.mocked(IdentityLinkService.listClaimsForMember).mockResolvedValue([]);

    await useIdentityLinkStore.getState().propose("w1", "m1", "w2", "m2");

    expect(IdentityLinkService.propose).toHaveBeenCalledWith(
      "w1",
      "m1",
      "w2",
      "m2",
    );
    expect(
      useIdentityLinkStore.getState().linksByMember["m1"].map((l) => l.status),
    ).toEqual(["proposed"]);
  });

  it("loadClaimInbox populates incoming and outgoing separately", async () => {
    vi.mocked(IdentityLinkService.listIncomingClaims).mockResolvedValue([
      claim("in1"),
    ]);
    vi.mocked(IdentityLinkService.listOutgoingClaims).mockResolvedValue([
      claim("out1"),
    ]);

    await useIdentityLinkStore.getState().loadClaimInbox();

    const state = useIdentityLinkStore.getState();
    expect(state.incomingClaims.map((c) => c.id)).toEqual(["in1"]);
    expect(state.outgoingClaims.map((c) => c.id)).toEqual(["out1"]);
  });

  it("completeClaim calls the service with the chosen workspace/member and refreshes the inbox", async () => {
    vi.mocked(IdentityLinkService.completeClaim).mockResolvedValue(link("l1"));
    vi.mocked(IdentityLinkService.listIncomingClaims).mockResolvedValue([]);
    vi.mocked(IdentityLinkService.listOutgoingClaims).mockResolvedValue([]);

    await useIdentityLinkStore.getState().completeClaim("c1", "w3", "m3");

    expect(IdentityLinkService.completeClaim).toHaveBeenCalledWith(
      "c1",
      "w3",
      "m3",
    );
    expect(IdentityLinkService.listIncomingClaims).toHaveBeenCalledTimes(1);
  });

  it("clear resets every slice", async () => {
    vi.mocked(IdentityLinkService.listForMember).mockResolvedValue([
      link("l1"),
    ]);
    vi.mocked(IdentityLinkService.listClaimsForMember).mockResolvedValue([]);
    await useIdentityLinkStore.getState().loadForMember("w1", "m1");

    useIdentityLinkStore.getState().clear();

    expect(useIdentityLinkStore.getState().linksByMember).toEqual({});
  });
});
