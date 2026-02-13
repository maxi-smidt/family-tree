import { RELATION_TYPES as CONSTANT_RELATION_TYPES } from "@/constants";

export type Gender = "m" | "f" | "o";

export const RELATION_TYPES = CONSTANT_RELATION_TYPES as readonly string[];

export type RelationType = (typeof RELATION_TYPES)[number];

export interface Relation {
  fromMemberId: string;
  toMemberId: string;
  relationType: RelationType;
}

export interface Member {
  id: string;
  gender: Gender;
  firstName: string;
  lastName: string;
  maidenName: string | null;
  imageData: string | null;
  date: {
    birth: string;
    death: string | null;
  };
  parents: {
    paternalParent: string | null;
    maternalParent: string | null;
  };
  additionalData: string | null;
  isCollapsed: boolean;
  position: {
    x: number;
    y: number;
  };
  relations?: Relation[];
  onEdit?: () => void;
  onView?: () => void;
  [key: string]: unknown;
}

export interface MemberDB {
  id: string;
  gender: string;
  firstName: string;
  lastName: string;
  maidenName: string | null;
  imageData: string | null;
  dateOfBirth: string;
  dateOfDeath: string | null;
  additionalData: string | null;
  isCollapsed: number;
  positionX: number;
  positionY: number;
}

export interface RelationDB {
  from_member_id: string;
  to_member_id: string;
  relation_type: string;
}

export interface MemberUpdate {
  gender?: Gender;
  firstName?: string;
  lastName?: string;
  maidenName?: string;
  imageData?: string;
  dateOfBirth?: string;
  dateOfDeath?: string;
  paternalParentId?: string | null;
  maternalParentId?: string | null;
  additionalData?: string;
  isCollapsed?: boolean;
  positionX?: number;
  positionY?: number;
}

export function mapMemberFromDB(
  row: MemberDB,
  relations: RelationDB[] = [],
): Member {
  return {
    id: row.id,
    gender: (row.gender as Gender) || "o",
    firstName: row.firstName,
    lastName: row.lastName,
    maidenName: row.maidenName,
    imageData: row.imageData,
    date: {
      birth: row.dateOfBirth,
      death: row.dateOfDeath,
    },
    parents: {
      paternalParent: null,
      maternalParent: null,
    },
    additionalData: row.additionalData,
    isCollapsed: !!row.isCollapsed,
    position: {
      x: row.positionX,
      y: row.positionY,
    },
    relations: relations.map((r) => ({
      fromMemberId: r.from_member_id,
      toMemberId: r.to_member_id,
      relationType: r.relation_type as RelationType,
    })),
  };
}

export function mapMemberToDB(member: Member): MemberDB {
  return {
    id: member.id,
    gender: member.gender,
    firstName: member.firstName,
    lastName: member.lastName,
    maidenName: member.maidenName,
    imageData: member.imageData,
    dateOfBirth: member.date.birth,
    dateOfDeath: member.date.death,
    positionX: member.position.x,
    positionY: member.position.y,
    additionalData: member.additionalData ? member.additionalData : null,
    isCollapsed: member.isCollapsed ? 1 : 0,
  };
}
