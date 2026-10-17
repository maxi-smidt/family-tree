import { MemberSheetState } from "@/utils/memberSheetState";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MemberSheetStoreState {
  /**
   * The open sheet for each tree. This is persisted because reopening the app
   * should restore a member the user was already working with, but it must
   * never leak state between workspaces.
   */
  openSheets: Record<string, MemberSheetState>;
  setOpenSheet: (workspaceId: string, state: MemberSheetState) => void;
  clearOpenSheet: (workspaceId: string) => void;
}

export const useMemberSheetStore = create<MemberSheetStoreState>()(
  persist(
    (set) => ({
      openSheets: {},
      setOpenSheet: (workspaceId, state) =>
        set((current) => ({
          openSheets: { ...current.openSheets, [workspaceId]: state },
        })),
      clearOpenSheet: (workspaceId) =>
        set((current) => {
          const { [workspaceId]: _, ...openSheets } = current.openSheets;
          return { openSheets };
        }),
    }),
    { name: "ft-member-sheet-state", version: 1 },
  ),
);
