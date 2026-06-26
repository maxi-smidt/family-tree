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
});
