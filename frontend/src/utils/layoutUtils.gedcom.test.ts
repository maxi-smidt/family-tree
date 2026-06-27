/**
 * Regression test for GEDCOM import with "BEF 1828" qualifier dates and
 * a married-couple + child topology (three members, three relations).
 *
 * The GEDCOM 5.5.5 sample (555SAMPLE16BE.GED) contains:
 *   - Robert Eugene Williams (m)    dateOfBirth "1822"
 *   - Mary Ann Wilson        (f)    dateOfBirth "BEF 1828"  ← non-ISO qualifier
 *   - Joe Williams           (m)    dateOfBirth "11 Jun 1845"
 * Relations: married(Robert→Mary), parent(Joe→Robert), parent(Joe→Mary)
 */
import { describe, it, expect } from "vitest";
import { getLayoutedElements } from "./layoutUtils";
import { Member } from "@/types/member";

const ROBERT: Member = {
  id: "robert",
  firstName: "Robert",
  lastName: "Williams",
  gender: "m",
  academicTitle: null,
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  date: { birth: "1822", death: null },
  parents: { paternalParent: null, maternalParent: null },
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: [],
  deceased: false,
  adopted: false,
  isCollapsed: false,
  position: { x: 0, y: 0 },
  relations: [
    { fromMemberId: "robert", toMemberId: "mary", relationType: "married" },
  ],
};

const MARY: Member = {
  id: "mary",
  firstName: "Mary",
  lastName: "Wilson",
  gender: "f",
  academicTitle: null,
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  date: { birth: "BEF 1828", death: null }, // ← GEDCOM qualifier date — not ISO
  parents: { paternalParent: null, maternalParent: null },
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: [],
  deceased: false,
  adopted: false,
  isCollapsed: false,
  position: { x: 0, y: 0 },
  relations: [],
};

const JOE: Member = {
  id: "joe",
  firstName: "Joe",
  lastName: "Williams",
  gender: "m",
  academicTitle: null,
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  date: { birth: "11 Jun 1845", death: null },
  parents: { paternalParent: "robert", maternalParent: "mary" },
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: [],
  deceased: false,
  adopted: false,
  isCollapsed: false,
  position: { x: 0, y: 0 },
  relations: [
    { fromMemberId: "joe", toMemberId: "robert", relationType: "parent" },
    { fromMemberId: "joe", toMemberId: "mary", relationType: "parent" },
  ],
};

describe("getLayoutedElements — GEDCOM import topology", () => {
  it("returns positions for all three members (married couple + child)", () => {
    const members = [ROBERT, MARY, JOE];
    const positions = getLayoutedElements(members);

    expect(Object.keys(positions)).toHaveLength(3);
    expect(positions["robert"]).toBeDefined();
    expect(positions["mary"]).toBeDefined();
    expect(positions["joe"]).toBeDefined();
  });

  it("positions are finite numbers even when a birth date is a GEDCOM qualifier (BEF 1828)", () => {
    const members = [ROBERT, MARY, JOE];
    const positions = getLayoutedElements(members);

    for (const [id, pos] of Object.entries(positions)) {
      expect(
        Number.isFinite(pos.x),
        `${id}.x should be a finite number, got ${pos.x}`,
      ).toBe(true);
      expect(
        Number.isFinite(pos.y),
        `${id}.y should be a finite number, got ${pos.y}`,
      ).toBe(true);
    }
  });

  it("positions are snapped to the 50px grid", () => {
    const members = [ROBERT, MARY, JOE];
    const positions = getLayoutedElements(members);

    for (const [id, pos] of Object.entries(positions)) {
      expect(pos.x % 50, `${id}.x not on grid`).toBe(0);
      expect(pos.y % 50, `${id}.y not on grid`).toBe(0);
    }
  });

  it("does not throw when all members start at position (0, 0)", () => {
    // All imported GEDCOM members start at (0,0)
    const members = [ROBERT, MARY, JOE].map((m) => ({
      ...m,
      position: { x: 0, y: 0 },
    }));
    expect(() => getLayoutedElements(members)).not.toThrow();
  });
});
