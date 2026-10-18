import { describe, expect, it } from "vitest";
import {
  formatLocation,
  isHistoryStep,
  parseLocation,
  type AppLocation,
} from "./appLocation";

const BASE: AppLocation = {
  workspaceId: "ws-1",
  view: "tree-view",
  mediaSection: "gallery",
  scope: { kind: "explore", focusId: null },
  member: null,
};

describe("formatLocation", () => {
  it("names the workspace and page in the path", () => {
    expect(formatLocation(BASE)).toBe("/w/ws-1/tree");
    expect(formatLocation({ ...BASE, view: "list-view" })).toBe("/w/ws-1/list");
    expect(
      formatLocation({
        ...BASE,
        view: "media-view",
        mediaSection: "documents",
      }),
    ).toBe("/w/ws-1/documents");
  });

  it("puts canvas scope and the open member in the query on the tree", () => {
    expect(
      formatLocation({
        ...BASE,
        scope: { kind: "saved-view", id: "v1" },
        member: { id: "m1", tab: "life" },
      }),
    ).toBe("/w/ws-1/tree?view=v1&member=m1&tab=life");
    expect(
      formatLocation({ ...BASE, scope: { kind: "section", id: "s1" } }),
    ).toBe("/w/ws-1/tree?section=s1");
    expect(
      formatLocation({
        ...BASE,
        scope: { kind: "explore", focusId: "m2" },
        member: { id: "m3", tab: "identity" },
      }),
    ).toBe("/w/ws-1/tree?focus=m2&member=m3");
  });

  it("leaves canvas state out of other pages", () => {
    expect(
      formatLocation({
        ...BASE,
        view: "timeline-view",
        scope: { kind: "section", id: "s1" },
        member: { id: "m1", tab: "life" },
      }),
    ).toBe("/w/ws-1/timeline");
  });
});

describe("parseLocation", () => {
  it("round-trips what formatLocation writes", () => {
    const locations: AppLocation[] = [
      BASE,
      { ...BASE, view: "map-view" },
      { ...BASE, view: "media-view", mediaSection: "documents" },
      {
        ...BASE,
        scope: { kind: "saved-view", id: "v1" },
        member: { id: "m1", tab: "records" },
      },
      { ...BASE, scope: { kind: "section", id: "s 1/x" } },
      { ...BASE, scope: { kind: "explore", focusId: "m2" } },
    ];
    for (const location of locations) {
      const url = new URL(formatLocation(location), "http://x");
      expect(parseLocation(url.pathname, url.search)).toMatchObject({
        workspaceId: location.workspaceId,
        view: location.view,
        scope: location.scope,
        member: location.member,
      });
    }
  });

  it("asks for nothing on a bare path", () => {
    expect(parseLocation("/", "")).toEqual({
      workspaceId: null,
      view: null,
      mediaSection: null,
      scope: { kind: "explore", focusId: null },
      member: null,
    });
  });

  it("still opens an old ?member= link on the tree", () => {
    expect(
      parseLocation("/", "?member=m1&memberTab=records&memberMode=edit"),
    ).toMatchObject({
      workspaceId: null,
      view: "tree-view",
      member: { id: "m1", tab: "records" },
    });
  });

  it("falls back safely for unknown pages, tabs and blank ids", () => {
    expect(parseLocation("/w/ws-1/nope", "")).toMatchObject({
      workspaceId: "ws-1",
      view: null,
    });
    expect(
      parseLocation("/w/ws-1/tree", "?member=m1&tab=bogus").member,
    ).toEqual({ id: "m1", tab: "identity" });
    expect(parseLocation("/w/ws-1/tree", "?member=%20&focus=").member).toBe(
      null,
    );
    expect(parseLocation("/w/%E0%A4%A/tree", "").workspaceId).toBe(null);
  });

  it("ignores canvas params on other pages", () => {
    expect(
      parseLocation("/w/ws-1/list", "?section=s1&member=m1"),
    ).toMatchObject({
      view: "list-view",
      scope: { kind: "explore", focusId: null },
      member: null,
    });
  });
});

describe("isHistoryStep", () => {
  it("treats only a member-sheet tab switch as minor", () => {
    const open = { ...BASE, member: { id: "m1", tab: "identity" as const } };
    expect(
      isHistoryStep(open, { ...open, member: { id: "m1", tab: "life" } }),
    ).toBe(false);
    expect(isHistoryStep(BASE, open)).toBe(true);
    expect(isHistoryStep(open, BASE)).toBe(true);
    expect(isHistoryStep(BASE, { ...BASE, view: "list-view" })).toBe(true);
    expect(
      isHistoryStep(BASE, {
        ...BASE,
        scope: { kind: "explore", focusId: "m2" },
      }),
    ).toBe(true);
    expect(isHistoryStep(BASE, { ...BASE, workspaceId: "ws-2" })).toBe(true);
  });
});
