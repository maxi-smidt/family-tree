import { useMemo } from "react";
import { Member } from "@/types/member";

export interface UnionInfo extends Record<string, unknown> {
  id: string;
  partner1Id: string;
  partner2Id: string;
  /** IDs of children whose both parents are this pair. */
  childIds: string[];
  /** Relation type driving this union (undefined = parent-derived only). */
  relationType?: string;
}

const COUPLE_RELATIONS = new Set(["married", "partner", "divorced"]);

const unionKey = (a: string, b: string) => `union-${[a, b].sort().join("-")}`;

export function useFlowUnions(members: Member[]): UnionInfo[] {
  return useMemo(() => {
    const memberIds = new Set(members.map((m) => m.id));
    const unions = new Map<string, UnionInfo>();

    const getOrCreate = (
      p1: string,
      p2: string,
      relType?: string,
    ): UnionInfo => {
      const id = unionKey(p1, p2);
      if (!unions.has(id)) {
        unions.set(id, {
          id,
          partner1Id: p1,
          partner2Id: p2,
          childIds: [],
          relationType: relType,
        });
      }
      const u = unions.get(id)!;
      // Prefer an explicit relation type over undefined.
      if (!u.relationType && relType) u.relationType = relType;
      return u;
    };

    // 1. Parent-derived unions: any child with two visible parents.
    for (const child of members) {
      const { paternalParent, maternalParent } = child.parents;
      if (
        paternalParent &&
        maternalParent &&
        memberIds.has(paternalParent) &&
        memberIds.has(maternalParent)
      ) {
        const u = getOrCreate(paternalParent, maternalParent);
        u.childIds.push(child.id);
      }
    }

    // 2. Explicit couple relations — create union even if no shared children.
    const seen = new Set<string>();
    for (const member of members) {
      if (!member.relations) continue;
      for (const rel of member.relations) {
        if (!COUPLE_RELATIONS.has(rel.relationType)) continue;
        if (!memberIds.has(rel.toMemberId)) continue;
        const key = unionKey(member.id, rel.toMemberId);
        if (seen.has(key)) continue;
        seen.add(key);
        getOrCreate(member.id, rel.toMemberId, rel.relationType);
      }
    }

    return Array.from(unions.values());
  }, [members]);
}
