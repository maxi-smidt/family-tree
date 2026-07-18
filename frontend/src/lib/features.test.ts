import { describe, expect, it } from "vitest";
import {
  ALL_FEATURES,
  filterViewsByFeatures,
  filterViewsByRestrictions,
  isFeatureName,
} from "./features";
import { ALL_VIEWS, TREE_VIEW, ViewId } from "./tabs";

describe("isFeatureName", () => {
  it("accepts every catalog entry and rejects unknown names", () => {
    for (const feature of ALL_FEATURES) {
      expect(isFeatureName(feature)).toBe(true);
    }
    expect(isFeatureName("unknown")).toBe(false);
  });
});

describe("filterViewsByFeatures", () => {
  const allFeatures = [...ALL_FEATURES];

  it("keeps every view when all features are enabled", () => {
    expect(filterViewsByFeatures([...ALL_VIEWS], allFeatures)).toEqual([
      ...ALL_VIEWS,
    ]);
  });

  it("drops only the views of disabled features", () => {
    const features = allFeatures.filter(
      (f) => f !== "gallery" && f !== "statistics",
    );
    const visible = filterViewsByFeatures([...ALL_VIEWS], features);
    expect(visible).not.toContain("gallery-view");
    expect(visible).not.toContain("statistics-view");
    expect(visible).toContain("tree-view");
    expect(visible).toContain("timeline-view");
  });

  it("never gates core views, even with no features enabled", () => {
    const visible = filterViewsByFeatures([...ALL_VIEWS], []);
    expect(visible).toEqual([
      "tree-view",
      "list-view",
      "database-management-view",
      "friends-view",
    ]);
  });

  it("falls back to the tree view when nothing would remain", () => {
    const views: ViewId[] = ["gallery-view", "statistics-view"];
    expect(filterViewsByFeatures(views, [])).toEqual([TREE_VIEW]);
  });

  it("gates the documents view with the existing sources feature", () => {
    const features = allFeatures.filter((feature) => feature !== "sources");
    const visible = filterViewsByFeatures([...ALL_VIEWS], features);

    expect(visible).not.toContain("documents-view");
  });
});

describe("filterViewsByRestrictions", () => {
  it("hides the documents view when the sources domain is restricted", () => {
    const visible = filterViewsByRestrictions([...ALL_VIEWS], ["sources"]);

    expect(visible).not.toContain("documents-view");
  });
});
