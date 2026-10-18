import { MemberSheetState } from "@/utils/memberSheetState";
import { create } from "zustand";

interface MemberSheetStoreState {
  /**
   * The open sheet for each tree. Kept per workspace so it never leaks state
   * between workspaces. Not persisted: the URL carries the open member
   * (`?member=…&tab=…`, see `useUrlLocation`), so a reload or a shared link
   * restores it and two tabs never overwrite each other's sheet.
   */
  openSheets: Record<string, MemberSheetState>;
  setOpenSheet: (workspaceId: string, state: MemberSheetState) => void;
  clearOpenSheet: (workspaceId: string) => void;
}

// Before #1128 the open sheets were persisted under this key; drop the
// leftover so a stale entry never lingers in the browser.
try {
  localStorage.removeItem("ft-member-sheet-state");
} catch {
  /* storage unavailable — nothing to clean up */
}

export const useMemberSheetStore = create<MemberSheetStoreState>()((set) => ({
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
}));
