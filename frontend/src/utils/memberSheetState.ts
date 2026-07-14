export const MEMBER_SHEET_TABS = [
  "identity",
  "life",
  "relations",
  "records",
] as const;

export type MemberSheetTab = (typeof MEMBER_SHEET_TABS)[number];
export type MemberSheetMode = "view" | "edit";

export interface MemberSheetState {
  memberId: string;
  tab: MemberSheetTab;
  mode: MemberSheetMode;
}

const MEMBER_PARAM = "member";
const TAB_PARAM = "memberTab";
const MODE_PARAM = "memberMode";

/**
 * Reads the former member-sheet query parameters as a one-time deep-link
 * request. The Zustand member-sheet store is the source of truth; callers
 * validate this request against the active tree before restoring it.
 */
export function readMemberSheetDeepLink(
  search = window.location.search,
): MemberSheetState | null {
  const params = new URLSearchParams(search);
  const memberId = params.get(MEMBER_PARAM)?.trim();
  const tab = params.get(TAB_PARAM);
  const mode = params.get(MODE_PARAM);

  if (!memberId) return null;

  return {
    memberId,
    tab: MEMBER_SHEET_TABS.includes(tab as MemberSheetTab)
      ? (tab as MemberSheetTab)
      : "identity",
    mode: mode === "edit" ? "edit" : "view",
  };
}

/** Removes consumed or invalid member-sheet deep-link parameters. */
export function clearMemberSheetDeepLink(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(MEMBER_PARAM);
  url.searchParams.delete(TAB_PARAM);
  url.searchParams.delete(MODE_PARAM);
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}
