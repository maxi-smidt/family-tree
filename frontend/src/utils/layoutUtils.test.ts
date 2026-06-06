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
        maidenName: null,
        imageData: null,
        date: { birth: "1990-01-01", death: null },
        parents: { paternalParent: null, maternalParent: null },
        additionalData: null,
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
        maidenName: null,
        imageData: null,
        date: { birth: "1960-01-01", death: null },
        parents: { paternalParent: null, maternalParent: null },
        additionalData: null,
        isCollapsed: false,
        position: { x: 0, y: 0 },
      },
      {
        id: "2",
        firstName: "Child",
        lastName: "One",
        gender: "m",
        maidenName: null,
        imageData: null,
        date: { birth: "1990-01-01", death: null },
        parents: { paternalParent: "1", maternalParent: null },
        additionalData: null,
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
        maidenName: null,
        imageData: null,
        date: { birth: "1992-01-01", death: null },
        parents: { paternalParent: "1", maternalParent: null },
        additionalData: null,
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

  it("should snap positions to grid", () => {
    const members: Member[] = [
      {
        id: "1",
        firstName: "John",
        lastName: "Doe",
        gender: "m",
        maidenName: null,
        imageData: null,
        date: { birth: "1990-01-01", death: null },
        parents: { paternalParent: null, maternalParent: null },
        additionalData: null,
        isCollapsed: false,
        position: { x: 0, y: 0 },
      },
    ];

    const positions = getLayoutedElements(members);
    expect(positions["1"].x % 50).toBe(0);
    expect(positions["1"].y % 50).toBe(0);
  });
});
