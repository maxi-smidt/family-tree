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
