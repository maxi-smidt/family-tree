import { afterEach, describe, expect, it } from "vitest";
import {
  clearMemberSheetState,
  readMemberSheetState,
  writeMemberSheetState,
} from "./memberSheetState";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("member sheet URL state", () => {
  it("reads valid persisted state", () => {
    expect(
      readMemberSheetState(
        "?member=member-1&memberTab=records&memberMode=edit",
      ),
    ).toEqual({ memberId: "member-1", tab: "records", mode: "edit" });
  });

  it("ignores incomplete or invalid state", () => {
    expect(readMemberSheetState("?member=member-1")).toBeNull();
    expect(
      readMemberSheetState("?member=member-1&memberTab=unknown"),
    ).toBeNull();
  });

  it("writes and clears only member-sheet parameters", () => {
    window.history.replaceState(null, "", "/tree?foo=bar#member");

    writeMemberSheetState({
      memberId: "member-1",
      tab: "life",
      mode: "view",
    });

    expect(window.location.search).toBe(
      "?foo=bar&member=member-1&memberTab=life&memberMode=view",
    );

    clearMemberSheetState();

    expect(window.location.pathname).toBe("/tree");
    expect(window.location.search).toBe("?foo=bar");
    expect(window.location.hash).toBe("#member");
  });
});
