import { describe, it, expect } from "vitest";
import { compareVersions, isNewerVersion } from "./version";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns positive when a > b", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("returns negative when a < b", () => {
    expect(compareVersions("1.2.2", "1.2.3")).toBeLessThan(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });

  it("handles unequal segment lengths", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBeGreaterThan(0);
  });

  it("strips leading v prefix", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v2.0.0", "v1.9.0")).toBeGreaterThan(0);
  });

  it("treats non-versions as lower than parseable ones", () => {
    expect(compareVersions("dev", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "dev")).toBeGreaterThan(0);
    expect(compareVersions("dev", "dev")).toBe(0);
  });
});

describe("isNewerVersion", () => {
  it("returns true when candidate is strictly newer", () => {
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
  });

  it("returns false when candidate equals baseline", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns false when candidate is older", () => {
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(false);
  });

  it("returns true when baseline is null (never acknowledged)", () => {
    expect(isNewerVersion("1.0.0", null)).toBe(true);
    expect(isNewerVersion("0.0.1", null)).toBe(true);
  });

  it("returns false for non-version candidates", () => {
    expect(isNewerVersion("dev", null)).toBe(false);
    expect(isNewerVersion("unknown", null)).toBe(false);
    expect(isNewerVersion("", null)).toBe(false);
    expect(isNewerVersion("dev", "1.0.0")).toBe(false);
  });

  it("returns false when both are non-versions", () => {
    expect(isNewerVersion("dev", "dev")).toBe(false);
    expect(isNewerVersion("unknown", "unknown")).toBe(false);
  });

  it("handles v-prefix in both", () => {
    expect(isNewerVersion("v1.2.4", "v1.2.3")).toBe(true);
    expect(isNewerVersion("v1.2.3", "v1.2.3")).toBe(false);
  });

  it("handles v-prefix mismatch", () => {
    expect(isNewerVersion("v1.2.4", "1.2.3")).toBe(true);
    expect(isNewerVersion("1.2.4", "v1.2.3")).toBe(true);
  });
});
