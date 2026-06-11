import { describe, expect, it } from "vitest";
import { nextMemberPosition } from "./pendingMemberUtils";

describe("nextMemberPosition", () => {
  const anchor = { x: 100, y: 200 };

  it("child placement: y+200", () => {
    expect(nextMemberPosition(anchor, "child")).toEqual({ x: 100, y: 400 });
  });

  it("parent placement: y-200", () => {
    expect(nextMemberPosition(anchor, "parent")).toEqual({ x: 100, y: 0 });
  });

  it("left placement: x-300", () => {
    expect(nextMemberPosition(anchor, "left")).toEqual({ x: -200, y: 200 });
  });

  it("right placement: x+300", () => {
    expect(nextMemberPosition(anchor, "right")).toEqual({ x: 400, y: 200 });
  });

  it("works at origin", () => {
    const origin = { x: 0, y: 0 };
    expect(nextMemberPosition(origin, "child")).toEqual({ x: 0, y: 200 });
    expect(nextMemberPosition(origin, "parent")).toEqual({ x: 0, y: -200 });
    expect(nextMemberPosition(origin, "left")).toEqual({ x: -300, y: 0 });
    expect(nextMemberPosition(origin, "right")).toEqual({ x: 300, y: 0 });
  });
});
