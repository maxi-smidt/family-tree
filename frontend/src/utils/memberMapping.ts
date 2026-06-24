import { Member, MemberDB, RelationDB, mapMemberFromDB } from "@/types/member";
import { reconstructParents } from "@/utils/memberUtils";

export function mapMembersFromRows(
  members: MemberDB[],
  relations: RelationDB[],
): Member[] {
  const memberGenderMap = new Map<string, string>();
  for (const m of members) memberGenderMap.set(m.id, m.gender ?? "o");

  const relationsByMember = new Map<string, RelationDB[]>();
  for (const r of relations) {
    const existing = relationsByMember.get(r.from_member_id);
    if (existing) existing.push(r);
    else relationsByMember.set(r.from_member_id, [r]);
  }

  return members.map((member) => {
    const memberRelations = relationsByMember.get(member.id) ?? [];
    const mapped = mapMemberFromDB(member, memberRelations, []);
    mapped.parents = reconstructParents(
      memberRelations.filter((r) => r.relation_type === "parent"),
      memberGenderMap,
    );
    return mapped;
  });
}
