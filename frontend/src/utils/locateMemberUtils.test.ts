import { describe, expect, it } from "vitest";
import { Member } from "@/types/member";
import { collectCollapsedAncestorIds } from "./locateMemberUtils";

const member = (
  id: string,
  options: {
    paternalParent?: string | null;
    maternalParent?: string | null;
    isCollapsed?: boolean;
  } = {},
): Member => ({
  id,
  firstName: id,
  lastName: "Test",
  gender: "o",
  academicTitle: null,
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  deceased: false,
  date: { birth: "1990-01-01", death: null },
  parents: {
    paternalParent: options.paternalParent ?? null,
    maternalParent: options.maternalParent ?? null,
  },
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: [],
  isCollapsed: options.isCollapsed ?? false,
  position: { x: 0, y: 0 },
});

describe("collectCollapsedAncestorIds", () => {
  it("returns empty array when no ancestors are collapsed", () => {
    const members = [
      member("grandparent", { isCollapsed: false }),
      member("parent", { paternalParent: "grandparent", isCollapsed: false }),
      member("child", { paternalParent: "parent" }),
    ];
    expect(collectCollapsedAncestorIds(members, "child")).toEqual([]);
  });

  it("returns collapsed direct parent", () => {
    const members = [
      member("parent", { isCollapsed: true }),
      member("child", { paternalParent: "parent" }),
    ];
    const result = collectCollapsedAncestorIds(members, "child");
    expect(result).toContain("parent");
  });

  it("returns all collapsed ancestors in the chain", () => {
    const members = [
      member("grandparent", { isCollapsed: true }),
      member("parent", { paternalParent: "grandparent", isCollapsed: true }),
      member("child", { paternalParent: "parent" }),
    ];
    const result = collectCollapsedAncestorIds(members, "child");
    expect(result).toContain("parent");
    expect(result).toContain("grandparent");
  });

  it("handles missing parents without throwing", () => {
    const members = [member("child", { paternalParent: "nonexistent" })];
    expect(() => collectCollapsedAncestorIds(members, "child")).not.toThrow();
    expect(collectCollapsedAncestorIds(members, "child")).toEqual([]);
  });

  it("handles cycles without infinite loop", () => {
    // Manually construct cyclic parents (data integrity issue)
    const memberA = member("a", { paternalParent: "b" });
    const memberB = member("b", { paternalParent: "a", isCollapsed: true });
    const members = [memberA, memberB];
    // Should complete without infinite loop
    expect(() => collectCollapsedAncestorIds(members, "a")).not.toThrow();
  });

  it("returns empty array when member does not exist", () => {
    const members = [member("a")];
    expect(collectCollapsedAncestorIds(members, "nonexistent")).toEqual([]);
  });

  it("handles both maternal and paternal parents", () => {
    const members = [
      member("mom", { isCollapsed: true }),
      member("dad", { isCollapsed: false }),
      member("child", { maternalParent: "mom", paternalParent: "dad" }),
    ];
    const result = collectCollapsedAncestorIds(members, "child");
    expect(result).toContain("mom");
    expect(result).not.toContain("dad");
  });
});
