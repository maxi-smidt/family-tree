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

export function readMemberSheetState(
  search = window.location.search,
): MemberSheetState | null {
  const params = new URLSearchParams(search);
  const memberId = params.get(MEMBER_PARAM);
  const tab = params.get(TAB_PARAM);
  const mode = params.get(MODE_PARAM);

  if (!memberId || !tab || !MEMBER_SHEET_TABS.includes(tab as MemberSheetTab)) {
    return null;
  }

  return {
    memberId,
    tab: tab as MemberSheetTab,
    mode: mode === "edit" ? "edit" : "view",
  };
}

export function writeMemberSheetState(state: MemberSheetState): void {
  const url = new URL(window.location.href);
  url.searchParams.set(MEMBER_PARAM, state.memberId);
  url.searchParams.set(TAB_PARAM, state.tab);
  url.searchParams.set(MODE_PARAM, state.mode);
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function clearMemberSheetState(): void {
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
