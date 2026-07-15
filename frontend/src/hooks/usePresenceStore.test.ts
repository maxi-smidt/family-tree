import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useMemberEditors,
  useOtherPresences,
  usePresenceStore,
} from "./usePresenceStore";
import { useTreeStore } from "./useTreeStore";
import { useAuthStore } from "./useAuthStore";
import { PresenceUserDB } from "@/types/presence";
import { Tree } from "@/types/tree";
import { User } from "@/types/user";

const TREE: Tree = { id: "t1", name: "Tree", role: "owner" };

const ROWS: PresenceUserDB[] = [
  { user_id: "me", display_name: "Me", editing_member_id: null },
  { user_id: "u2", display_name: "Anna", editing_member_id: "m5" },
];

beforeEach(() => {
  usePresenceStore.setState({ roster: [] });
  useTreeStore.setState({ selectedTree: TREE });
  useAuthStore.setState({ user: { id: "me" } as unknown as User });
});

describe("usePresenceStore — setRoster", () => {
  it("maps DB rows to camelCase for the active tree", () => {
    usePresenceStore.getState().setRoster("t1", ROWS);

    const roster = usePresenceStore.getState().roster;
    expect(roster).toEqual([
      { userId: "me", displayName: "Me", editingMemberId: null },
      { userId: "u2", displayName: "Anna", editingMemberId: "m5" },
    ]);
  });

  it("ignores a roster for a tree that is no longer active", () => {
    usePresenceStore.getState().setRoster("other-tree", ROWS);
    expect(usePresenceStore.getState().roster).toEqual([]);
  });

  it("clear empties the roster", () => {
    usePresenceStore.getState().setRoster("t1", ROWS);
    usePresenceStore.getState().clear();
    expect(usePresenceStore.getState().roster).toEqual([]);
  });
});

describe("useOtherPresences", () => {
  it("excludes the current user from the roster", () => {
    usePresenceStore.getState().setRoster("t1", ROWS);

    const { result } = renderHook(() => useOtherPresences());
    expect(result.current.map((u) => u.userId)).toEqual(["u2"]);
  });
});

describe("useMemberEditors", () => {
  it("returns other users editing the given member", () => {
    usePresenceStore.getState().setRoster("t1", ROWS);

    const { result } = renderHook(() => useMemberEditors("m5"));
    expect(result.current.map((u) => u.displayName)).toEqual(["Anna"]);
  });

  it("does not report the current user as an editor of their own member", () => {
    usePresenceStore.getState().setRoster("t1", [
      { user_id: "me", display_name: "Me", editing_member_id: "m9" },
    ]);

    const { result } = renderHook(() => useMemberEditors("m9"));
    expect(result.current).toEqual([]);
  });

  it("returns nothing when memberId is undefined", () => {
    usePresenceStore.getState().setRoster("t1", ROWS);

    const { result } = renderHook(() => useMemberEditors(undefined));
    expect(result.current).toEqual([]);
  });
});
