import { afterEach, describe, expect, it } from "vitest";
import {
  clearMemberSheetDeepLink,
  readMemberSheetDeepLink,
} from "./memberSheetState";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("member sheet deep links", () => {
  it("reads a valid deep link", () => {
    expect(
      readMemberSheetDeepLink(
        "?member=member-1&memberTab=records&memberMode=edit",
      ),
    ).toEqual({ memberId: "member-1", tab: "records", mode: "edit" });
  });

  it("falls back safely for missing or invalid tab state", () => {
    expect(readMemberSheetDeepLink("?member=member-1")).toEqual({
      memberId: "member-1",
      tab: "identity",
      mode: "view",
    });
    expect(
      readMemberSheetDeepLink("?member=member-1&memberTab=unknown"),
    ).toEqual({ memberId: "member-1", tab: "identity", mode: "view" });
    expect(readMemberSheetDeepLink("?member=   ")).toBeNull();
  });

  it("clears only consumed member-sheet parameters", () => {
    window.history.replaceState(
      null,
      "",
      "/tree?foo=bar&member=member-1&memberTab=life&memberMode=view#member",
    );

    clearMemberSheetDeepLink();

    expect(window.location.pathname).toBe("/tree");
    expect(window.location.search).toBe("?foo=bar");
    expect(window.location.hash).toBe("#member");
  });
});
