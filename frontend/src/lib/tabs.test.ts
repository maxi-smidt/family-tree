import { describe, expect, it } from "vitest";
import {
  ALL_VIEWS,
  DATABASE_MANAGEMENT_VIEW,
  FRIENDS_VIEW,
  TREE_VIEW,
  resolveTabs,
} from "./tabs";

describe("resolveTabs", () => {
  it("returns full default order when inputs are empty", () => {
    const { ordered, visible } = resolveTabs([], []);
    expect(ordered).toEqual([...ALL_VIEWS]);
    expect(visible).toEqual([...ALL_VIEWS]);
  });

  it("respects saved order and appends missing tabs", () => {
    const { ordered } = resolveTabs(["list-view", "tree-view"], []);
    expect(ordered[0]).toBe("list-view");
    expect(ordered[1]).toBe("tree-view");
    expect(ordered).toHaveLength(ALL_VIEWS.length);
  });

  it("drops unknown IDs from order", () => {
    const { ordered } = resolveTabs(["unknown-view", "tree-view"], []);
    expect(ordered).not.toContain("unknown-view");
    expect(ordered).toHaveLength(ALL_VIEWS.length);
  });

  it("hides tabs in the hidden list", () => {
    const { visible } = resolveTabs([], ["gallery-view", "timeline-view"]);
    expect(visible).not.toContain("gallery-view");
    expect(visible).not.toContain("timeline-view");
  });

  it("ignores unknown IDs in hidden list", () => {
    const { visible } = resolveTabs([], ["not-a-tab"]);
    expect(visible).toEqual([...ALL_VIEWS]);
  });

  it("falls back to TREE_VIEW when all tabs are hidden", () => {
    const { visible } = resolveTabs([], [...ALL_VIEWS]);
    expect(visible).toEqual([TREE_VIEW]);
  });

  it("keeps the management and friends tabs last by default", () => {
    const { ordered } = resolveTabs([], []);
    expect(ordered.slice(-2)).toEqual([DATABASE_MANAGEMENT_VIEW, FRIENDS_VIEW]);
  });
});
