import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { formatKinship } from "@/utils/kinship";

/**
 * Mock TFunction that echoes the key and appends interpolated values, so tests
 * can assert which key was selected and what `count` was passed without pulling
 * in the real i18n resources.
 */
const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts && "count" in opts) return `${key}#${opts.count}`;
  if (opts) {
    const parts = Object.entries(opts).map(([k, v]) => `${k}=${v}`);
    return `${key}(${parts.join(",")})`;
  }
  return key;
}) as unknown as TFunction;

describe("formatKinship", () => {
  it("returns null for self and none", () => {
    expect(formatKinship({ kind: "self" }, "m", t)).toBeNull();
    expect(formatKinship({ kind: "none" }, "m", t)).toBeNull();
  });

  it("picks gendered keys", () => {
    expect(formatKinship({ kind: "parent" }, "m", t)).toBe(
      "tree-view.connection.kinship.parent-m",
    );
    expect(formatKinship({ kind: "parent" }, "f", t)).toBe(
      "tree-view.connection.kinship.parent-f",
    );
    expect(formatKinship({ kind: "parent" }, "o", t)).toBe(
      "tree-view.connection.kinship.parent-n",
    );
  });

  it("uses explicit keys for greats 0-2", () => {
    expect(formatKinship({ kind: "grandparent", greats: 0 }, "f", t)).toBe(
      "tree-view.connection.kinship.grandparent-0-f",
    );
    expect(formatKinship({ kind: "grandparent", greats: 2 }, "m", t)).toBe(
      "tree-view.connection.kinship.grandparent-2-m",
    );
  });

  it("renders the numeric-great key with count === greats (no off-by-one)", () => {
    // greats=3 means three literal "great" prefixes -> "3×-great-grandparent".
    expect(formatKinship({ kind: "grandparent", greats: 3 }, "m", t)).toBe(
      "tree-view.connection.kinship.grandparent-n-m#3",
    );
    expect(formatKinship({ kind: "grandchild", greats: 4 }, "f", t)).toBe(
      "tree-view.connection.kinship.grandchild-n-f#4",
    );
    expect(formatKinship({ kind: "pibling", greats: 3 }, "m", t)).toBe(
      "tree-view.connection.kinship.pibling-n-m#3",
    );
  });

  it("formats cousins with degree and removal", () => {
    // The mock `t` echoes the key for ordinal lookups, so degreeOrdinal/removal
    // take their numeric fallback paths — we assert on the chosen template key.
    expect(
      formatKinship({ kind: "cousin", degree: 1, removal: 0 }, "o", t),
    ).toBe("tree-view.connection.kinship.cousin(degree=1)");
    const removed = formatKinship(
      { kind: "cousin", degree: 2, removal: 1 },
      "o",
      t,
    );
    expect(removed).toContain("cousin-removed");
    expect(removed).toContain("degree=2");
  });

  // ---------------------------------------------------------------------------
  // Tier 2: partner, in-law, step relations
  // ---------------------------------------------------------------------------

  it("partner/married picks the married key by gender", () => {
    const ns = "tree-view.connection.kinship";
    expect(
      formatKinship({ kind: "partner", relationType: "married" }, "m", t),
    ).toBe(`${ns}.partner-married-m`);
    expect(
      formatKinship({ kind: "partner", relationType: "married" }, "f", t),
    ).toBe(`${ns}.partner-married-f`);
    expect(
      formatKinship({ kind: "partner", relationType: "married" }, "o", t),
    ).toBe(`${ns}.partner-married-n`);
  });

  it("partner/divorced picks the divorced key", () => {
    const ns = "tree-view.connection.kinship";
    expect(
      formatKinship({ kind: "partner", relationType: "divorced" }, "m", t),
    ).toBe(`${ns}.partner-divorced-m`);
    expect(
      formatKinship({ kind: "partner", relationType: "divorced" }, "f", t),
    ).toBe(`${ns}.partner-divorced-f`);
  });

  it("partner/partner picks the partner key", () => {
    const ns = "tree-view.connection.kinship";
    expect(
      formatKinship({ kind: "partner", relationType: "partner" }, "o", t),
    ).toBe(`${ns}.partner-partner-n`);
  });

  it("partner/unknown relationType falls back to partner key", () => {
    const ns = "tree-view.connection.kinship";
    expect(
      formatKinship({ kind: "partner", relationType: "other" }, "m", t),
    ).toBe(`${ns}.partner-partner-m`);
  });

  it("parent-in-law picks gendered keys", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "parent-in-law" }, "m", t)).toBe(
      `${ns}.parent-in-law-m`,
    );
    expect(formatKinship({ kind: "parent-in-law" }, "f", t)).toBe(
      `${ns}.parent-in-law-f`,
    );
    expect(formatKinship({ kind: "parent-in-law" }, "o", t)).toBe(
      `${ns}.parent-in-law-n`,
    );
  });

  it("child-in-law picks gendered keys", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "child-in-law" }, "m", t)).toBe(
      `${ns}.child-in-law-m`,
    );
    expect(formatKinship({ kind: "child-in-law" }, "f", t)).toBe(
      `${ns}.child-in-law-f`,
    );
  });

  it("sibling-in-law picks gendered keys", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "sibling-in-law" }, "m", t)).toBe(
      `${ns}.sibling-in-law-m`,
    );
    expect(formatKinship({ kind: "sibling-in-law" }, "f", t)).toBe(
      `${ns}.sibling-in-law-f`,
    );
    expect(formatKinship({ kind: "sibling-in-law" }, "o", t)).toBe(
      `${ns}.sibling-in-law-n`,
    );
  });

  it("step-parent picks gendered keys", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "step-parent" }, "m", t)).toBe(
      `${ns}.step-parent-m`,
    );
    expect(formatKinship({ kind: "step-parent" }, "f", t)).toBe(
      `${ns}.step-parent-f`,
    );
    expect(formatKinship({ kind: "step-parent" }, "o", t)).toBe(
      `${ns}.step-parent-n`,
    );
  });

  it("step-child picks gendered keys", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "step-child" }, "m", t)).toBe(
      `${ns}.step-child-m`,
    );
    expect(formatKinship({ kind: "step-child" }, "f", t)).toBe(
      `${ns}.step-child-f`,
    );
  });

  it("step-sibling picks gendered keys", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "step-sibling" }, "m", t)).toBe(
      `${ns}.step-sibling-m`,
    );
    expect(formatKinship({ kind: "step-sibling" }, "f", t)).toBe(
      `${ns}.step-sibling-f`,
    );
    expect(formatKinship({ kind: "step-sibling" }, "o", t)).toBe(
      `${ns}.step-sibling-n`,
    );
  });

  // ---------------------------------------------------------------------------
  // Tier 3: relative fallback
  // ---------------------------------------------------------------------------

  it("relative (not distant) returns the relative key, gender-neutral", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "relative", distant: false }, "m", t)).toBe(
      `${ns}.relative`,
    );
    expect(formatKinship({ kind: "relative", distant: false }, "f", t)).toBe(
      `${ns}.relative`,
    );
    expect(formatKinship({ kind: "relative", distant: false }, "o", t)).toBe(
      `${ns}.relative`,
    );
  });

  it("relative (distant) returns the distant-relative key, gender-neutral", () => {
    const ns = "tree-view.connection.kinship";
    expect(formatKinship({ kind: "relative", distant: true }, "m", t)).toBe(
      `${ns}.distant-relative`,
    );
    expect(formatKinship({ kind: "relative", distant: true }, "f", t)).toBe(
      `${ns}.distant-relative`,
    );
    expect(formatKinship({ kind: "relative", distant: true }, "o", t)).toBe(
      `${ns}.distant-relative`,
    );
  });
});
