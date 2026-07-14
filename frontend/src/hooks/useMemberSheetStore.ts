import { MemberSheetState } from "@/utils/memberSheetState";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MemberSheetStoreState {
  /**
   * The open sheet for each tree. This is persisted because reopening the app
   * should restore a member the user was already working with, but it must
   * never leak state between trees.
   */
  openSheets: Record<string, MemberSheetState>;
  setOpenSheet: (treeId: string, state: MemberSheetState) => void;
  clearOpenSheet: (treeId: string) => void;
}

export const useMemberSheetStore = create<MemberSheetStoreState>()(
  persist(
    (set) => ({
      openSheets: {},
      setOpenSheet: (treeId, state) =>
        set((current) => ({
          openSheets: { ...current.openSheets, [treeId]: state },
        })),
      clearOpenSheet: (treeId) =>
        set((current) => {
          const { [treeId]: _, ...openSheets } = current.openSheets;
          return { openSheets };
        }),
    }),
    { name: "ft-member-sheet-state", version: 1 },
  ),
);
