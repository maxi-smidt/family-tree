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
});
