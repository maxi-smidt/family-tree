import { describe, it, expect } from "vitest";
import { getLayoutedElements } from "./layoutUtils";
import { Member } from "@/types/member";

describe("getLayoutedElements", () => {
  it("should return positions for a single member", () => {
    const members: Member[] = [
      {
        id: "1",
        firstName: "John",
        lastName: "Doe",
        gender: "m",
        academicTitle: null,
        middleNames: null,
        baptismalName: null,
        maidenName: null,
        imageData: null,
        date: { birth: "1990-01-01", death: null },
        deceased: false,
        parents: { paternalParent: null, maternalParent: null },
        additionalData: null,
        birthplace: null,
        hometown: null,
        placesLived: [],
        isCollapsed: false,
        position: { x: 0, y: 0 },
      },
    ];

    const positions = getLayoutedElements(members);
    expect(positions["1"]).toBeDefined();
    expect(positions["1"].x).toBeTypeOf("number");
    expect(positions["1"].y).toBeTypeOf("number");
  });

  it("should handle empty member list", () => {
    const positions = getLayoutedElements([]);
    expect(Object.keys(positions).length).toBe(0);
  });

  it("should layout siblings close to each other", () => {
    const members: Member[] = [
      {
        id: "1",
        firstName: "Parent",
        lastName: "One",
        gender: "m",
        academicTitle: null,
        middleNames: null,
        baptismalName: null,
        maidenName: null,
        imageData: null,
        date: { birth: "1960-01-01", death: null },
        deceased: false,
        parents: { paternalParent: null, maternalParent: null },
        additionalData: null,
        birthplace: null,
        hometown: null,
        placesLived: [],
        isCollapsed: false,
        position: { x: 0, y: 0 },
      },
      {
        id: "2",
        firstName: "Child",
        lastName: "One",
        gender: "m",
        academicTitle: null,
        middleNames: null,
        baptismalName: null,
        maidenName: null,
        imageData: null,
        date: { birth: "1990-01-01", death: null },
        deceased: false,
        parents: { paternalParent: "1", maternalParent: null },
        additionalData: null,
        birthplace: null,
        hometown: null,
        placesLived: [],
        isCollapsed: false,
        position: { x: 0, y: 0 },
        relations: [
          { fromMemberId: "2", toMemberId: "3", relationType: "sibling" },
        ],
      },
      {
        id: "3",
        firstName: "Child",
        lastName: "Two",
        gender: "f",
        academicTitle: null,
        middleNames: null,
        baptismalName: null,
        maidenName: null,
        imageData: null,
        date: { birth: "1992-01-01", death: null },
        deceased: false,
        parents: { paternalParent: "1", maternalParent: null },
        additionalData: null,
        birthplace: null,
        hometown: null,
        placesLived: [],
        isCollapsed: false,
        position: { x: 0, y: 0 },
        relations: [
          { fromMemberId: "3", toMemberId: "2", relationType: "sibling" },
        ],
      },
    ];

    const positions = getLayoutedElements(members);
    expect(positions["2"]).toBeDefined();
    expect(positions["3"]).toBeDefined();

    // Siblings should be on the same Y level (approximately)
    expect(Math.abs(positions["2"].y - positions["3"].y)).toBeLessThan(10);
  });

  it("places a merged (vm_) node at the sibling-group edge facing its partner", () => {
    const base = {
      academicTitle: null,
      middleNames: null,
      baptismalName: null,
      maidenName: null,
      imageData: null,
      additionalData: null,
      birthplace: null,
      hometown: null,
      placesLived: [],
      isCollapsed: false,
      position: { x: 0, y: 0 },
    };
    const members: Member[] = [
      // Grandparents (parents of the merged node and its sibling).
      {
        ...base,
        id: "abe",
        firstName: "Abraham",
        lastName: "Simpson",
        gender: "m",
        date: { birth: "1920-01-01", death: null },
        deceased: false,
        parents: { paternalParent: null, maternalParent: null },
      },
      {
        ...base,
        id: "mona",
        firstName: "Mona",
        lastName: "Simpson",
        gender: "f",
        date: { birth: "1925-01-01", death: null },
        deceased: false,
        parents: { paternalParent: null, maternalParent: null },
        relations: [
          { fromMemberId: "mona", toMemberId: "abe", relationType: "married" },
        ],
      },
      // Merged node married to a spouse outside the sibling group.
      {
        ...base,
        id: "vm_homer",
        firstName: "Homer",
        lastName: "Simpson",
        gender: "m",
        date: { birth: "1956-05-12", death: null },
        deceased: false,
        parents: { paternalParent: "abe", maternalParent: "mona" },
        relations: [
          {
            fromMemberId: "vm_homer",
            toMemberId: "marge",
            relationType: "married",
          },
        ],
      },
      // His sibling (no partner).
      {
        ...base,
        id: "herb",
        firstName: "Herbert",
        lastName: "Powell",
        gender: "m",
        date: { birth: "1953-07-30", death: null },
        deceased: false,
        parents: { paternalParent: "abe", maternalParent: "mona" },
      },
      // The spouse.
      {
        ...base,
        id: "marge",
        firstName: "Marge",
        lastName: "Simpson",
        gender: "f",
        date: { birth: "1959-03-19", death: null },
        deceased: false,
        parents: { paternalParent: null, maternalParent: null },
      },
      // A shared child so the couple forms a parent union.
      {
        ...base,
        id: "bart",
        firstName: "Bart",
        lastName: "Simpson",
        gender: "m",
        date: { birth: "1985-04-01", death: null },
        deceased: false,
        parents: { paternalParent: "vm_homer", maternalParent: "marge" },
      },
    ];

    const positions = getLayoutedElements(members);

    // Homer and Herbert are siblings on the same row.
    expect(positions["vm_homer"].y).toBe(positions["herb"].y);
    // No sibling may sit between the merged node and its partner: Homer must
    // be the group member closest to Marge.
    const distHomer = Math.abs(positions["vm_homer"].x - positions["marge"].x);
    const distHerb = Math.abs(positions["herb"].x - positions["marge"].x);
    expect(distHomer).toBeLessThan(distHerb);
  });

  it("orders a married sibling next to a partner outside the group", () => {
    // The reported case: the merged node (Homer) has no siblings, but his
    // spouse Marge sits inside a 3-sister Bouvier group. Marge must end up on
    // the side of her group nearest Homer, not stranded at the far end.
    const base = {
      academicTitle: null,
      middleNames: null,
      baptismalName: null,
      maidenName: null,
      imageData: null,
      additionalData: null,
      birthplace: null,
      hometown: null,
      placesLived: [],
      isCollapsed: false,
      position: { x: 0, y: 0 },
    };
    const parents = (p: string | null, m: string | null) => ({
      paternalParent: p,
      maternalParent: m,
    });
    const members: Member[] = [
      // Homer's parents.
      {
        ...base,
        id: "abe",
        firstName: "Abraham",
        lastName: "Simpson",
        gender: "m",
        date: { birth: "1920-01-01", death: null },
        deceased: false,
        parents: parents(null, null),
      },
      {
        ...base,
        id: "mona",
        firstName: "Mona",
        lastName: "Simpson",
        gender: "f",
        date: { birth: "1925-01-01", death: null },
        deceased: false,
        parents: parents(null, null),
      },
      // The Bouvier sisters' parents.
      {
        ...base,
        id: "clancy",
        firstName: "Clancy",
        lastName: "Bouvier",
        gender: "m",
        date: { birth: "1930-01-01", death: null },
        deceased: false,
        parents: parents(null, null),
      },
      {
        ...base,
        id: "jackie",
        firstName: "Jacqueline",
        lastName: "Bouvier",
        gender: "f",
        date: { birth: "1932-01-01", death: null },
        deceased: false,
        parents: parents(null, null),
      },
      // Merged node — only child of Abe & Mona — married to Marge.
      {
        ...base,
        id: "vm_homer",
        firstName: "Homer",
        lastName: "Simpson",
        gender: "m",
        date: { birth: "1956-05-12", death: null },
        deceased: false,
        parents: parents("abe", "mona"),
        relations: [
          {
            fromMemberId: "vm_homer",
            toMemberId: "marge",
            relationType: "married",
          },
        ],
      },
      // The three Bouvier sisters (share parents → one sibling group).
      {
        ...base,
        id: "marge",
        firstName: "Marge",
        lastName: "Bouvier",
        gender: "f",
        date: { birth: "1959-03-19", death: null },
        deceased: false,
        parents: parents("clancy", "jackie"),
      },
      {
        ...base,
        id: "selma",
        firstName: "Selma",
        lastName: "Bouvier",
        gender: "f",
        date: { birth: "1957-01-01", death: null },
        deceased: false,
        parents: parents("clancy", "jackie"),
      },
      {
        ...base,
        id: "patty",
        firstName: "Patty",
        lastName: "Bouvier",
        gender: "f",
        date: { birth: "1957-01-02", death: null },
        deceased: false,
        parents: parents("clancy", "jackie"),
      },
      // A shared child so Homer & Marge form a parent union.
      {
        ...base,
        id: "bart",
        firstName: "Bart",
        lastName: "Simpson",
        gender: "m",
        date: { birth: "1985-04-01", death: null },
        deceased: false,
        parents: parents("vm_homer", "marge"),
      },
    ];

    const positions = getLayoutedElements(members);

    // The three sisters are on the same rank.
    expect(positions["marge"].y).toBe(positions["selma"].y);
    expect(positions["marge"].y).toBe(positions["patty"].y);
    // Marge must be the sister closest to Homer.
    const distMarge = Math.abs(positions["marge"].x - positions["vm_homer"].x);
    const distSelma = Math.abs(positions["selma"].x - positions["vm_homer"].x);
    const distPatty = Math.abs(positions["patty"].x - positions["vm_homer"].x);
    expect(distMarge).toBeLessThan(distSelma);
    expect(distMarge).toBeLessThan(distPatty);
  });

  it("should snap positions to grid", () => {
    const members: Member[] = [
      {
        id: "1",
        firstName: "John",
        lastName: "Doe",
        gender: "m",
        academicTitle: null,
        middleNames: null,
        baptismalName: null,
        maidenName: null,
        imageData: null,
        date: { birth: "1990-01-01", death: null },
        deceased: false,
        parents: { paternalParent: null, maternalParent: null },
        additionalData: null,
        birthplace: null,
        hometown: null,
        placesLived: [],
        isCollapsed: false,
        position: { x: 0, y: 0 },
      },
    ];

    const positions = getLayoutedElements(members);
    expect(positions["1"].x % 50).toBe(0);
    expect(positions["1"].y % 50).toBe(0);
  });
});
