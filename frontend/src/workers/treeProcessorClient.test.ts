import { describe, expect, it } from "vitest";
import type { Member } from "@/types/member";
import { treeProcessorClient } from "@/workers/treeProcessorClient";

function member(
  id: string,
  x: number,
  relations: Member["relations"] = [],
  parents: Member["parents"] = { paternalParent: null, maternalParent: null },
): Member {
  return {
    id,
    gender: "o",
    academicTitle: null,
    firstName: id,
    middleNames: null,
    baptismalName: null,
    lastName: "Test",
    maidenName: null,
    imageData: null,
    deceased: false,
    adopted: false,
    date: { birth: "", death: null },
    parents,
    additionalData: null,
    birthplace: null,
    hometown: null,
    placesLived: [],
    isCollapsed: false,
    position: { x, y: 0 },
    relations,
  };
}

describe("treeProcessorClient.computeLayout — sync path", () => {
  it("resolves to a record with finite x/y for each member id (small tree stays synchronous)", async () => {
    const members = [
      member("alice", 0),
      member("bob", 300),
      member("charlie", 150, [], { paternalParent: "alice", maternalParent: "bob" }),
    ];

    const positions = await treeProcessorClient.computeLayout("t1", members);

    expect(typeof positions).toBe("object");
    for (const m of members) {
      expect(positions[m.id], `positions["${m.id}"] should exist`).toBeDefined();
      expect(
        Number.isFinite(positions[m.id].x),
        `positions["${m.id}"].x should be finite`,
      ).toBe(true);
      expect(
        Number.isFinite(positions[m.id].y),
        `positions["${m.id}"].y should be finite`,
      ).toBe(true);
    }
  });

  it("returns an empty record for an empty members array", async () => {
    const positions = await treeProcessorClient.computeLayout("t1", []);
    expect(positions).toEqual({});
  });

  it("returns a record with finite x/y for a single member", async () => {
    const members = [member("solo", 0)];
    const positions = await treeProcessorClient.computeLayout("t1", members);
    expect(positions["solo"]).toBeDefined();
    expect(Number.isFinite(positions["solo"].x)).toBe(true);
    expect(Number.isFinite(positions["solo"].y)).toBe(true);
  });
});
