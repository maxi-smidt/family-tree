import { afterEach, describe, expect, it } from "vitest";
import { useMemberSheetStore } from "./useMemberSheetStore";

afterEach(() => {
  useMemberSheetStore.setState({ openSheets: {} });
  localStorage.removeItem("ft-member-sheet-state");
});

describe("useMemberSheetStore", () => {
  it("keeps open-sheet state scoped to its tree", () => {
    const { setOpenSheet, clearOpenSheet } = useMemberSheetStore.getState();

    setOpenSheet("tree-1", {
      memberId: "member-1",
      tab: "records",
      mode: "edit",
    });
    setOpenSheet("tree-2", {
      memberId: "member-2",
      tab: "life",
      mode: "view",
    });

    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "tree-1": { memberId: "member-1", tab: "records", mode: "edit" },
      "tree-2": { memberId: "member-2", tab: "life", mode: "view" },
    });

    clearOpenSheet("tree-1");

    expect(useMemberSheetStore.getState().openSheets).toEqual({
      "tree-2": { memberId: "member-2", tab: "life", mode: "view" },
    });
  });
});
