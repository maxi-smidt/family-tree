import { describe, expect, it } from "vitest";
import { getQuotaBucket, quotaToastKey } from "./quotaError";

describe("getQuotaBucket", () => {
  it("maps quota_exceeded_media to 'media'", () => {
    expect(getQuotaBucket("quota_exceeded_media")).toBe("media");
  });

  it("maps quota_exceeded_tree to 'tree'", () => {
    expect(getQuotaBucket("quota_exceeded_tree")).toBe("tree");
  });

  it("returns null for the removed total bucket", () => {
    expect(getQuotaBucket("quota_exceeded_total")).toBeNull();
  });

  it("returns null for an unrecognised message", () => {
    expect(getQuotaBucket("Request Entity Too Large")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(getQuotaBucket("")).toBeNull();
  });

  it("returns null for a partial match", () => {
    expect(getQuotaBucket("quota_exceeded")).toBeNull();
  });
});

describe("quotaToastKey", () => {
  it("generates toast-error-quota-media", () => {
    expect(quotaToastKey("media")).toBe("toast-error-quota-media");
  });

  it("generates toast-error-quota-tree", () => {
    expect(quotaToastKey("tree")).toBe("toast-error-quota-tree");
  });
});
