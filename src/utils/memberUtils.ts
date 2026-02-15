import { Member } from "@/types/member";

export interface MemberOption {
  label: string;
  value: string;
}

export function getMemberOptions(members: Member[]): MemberOption[] {
  return members.map((m) => ({
    label: `${m.firstName} ${m.lastName}`,
    value: m.id,
  }));
}
