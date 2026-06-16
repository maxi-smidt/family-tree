import { Disease } from "./disease";

export type Gender = "m" | "f" | "o";

/**
 * Relation types live in an instance-wide, admin-managed registry served by
 * the backend (`GET /relation-types`), so the type is an open string.
 */
export type RelationType = string;

/** The tree structure is built from "parent" relations; this type is fixed. */
export const PARENT_RELATION_TYPE: RelationType = "parent";

/** Row shape of the backend relation type registry. */
export interface RelationTypeDB {
  id: RelationType;
  description: string | null;
}

export interface Relation {
  fromMemberId: string;
  toMemberId: string;
  relationType: RelationType;
}

export interface PlaceLived {
  location: string;
  from?: string | null;
  to?: string | null;
}

export function isDeceased(member: Pick<Member, "deceased" | "date">): boolean {
  return member.deceased || !!member.date.death;
}

export interface Member {
  id: string;
  gender: Gender;
  academicTitle: string | null;
  firstName: string;
  middleNames: string | null;
  baptismalName: string | null;
  lastName: string;
  maidenName: string | null;
  imageData: string | null;
  deceased: boolean;
  date: {
    birth: string;
    death: string | null;
  };
  parents: {
    paternalParent: string | null;
    maternalParent: string | null;
  };
  additionalData: string | null;
  birthplace: string | null;
  hometown: string | null;
  placesLived: PlaceLived[];
  isCollapsed: boolean;
  position: {
    x: number;
    y: number;
  };
  relations?: Relation[];
  diseases?: Disease[];
  // Only set for members loaded from a virtual view.
  sourceTreeId?: string;
  sourceTreeName?: string;
  sourceTreeIds?: string[];
  sourceTreeNames?: string[];
  mergedFromIds?: string[];
  isMerged?: boolean;
  onEdit?: () => void;
  onView?: () => void;
  onAddChild?: () => void;
  onAddParent?: () => void;
  onAddLeft?: () => void;
  onAddRight?: () => void;
  [key: string]: unknown;
}

export class MemberObject {
  static equal(m1: Member, m2: Member) {
    return this.equalDB(mapMemberToDB(m1), mapMemberToDB(m2));
  }

  static equalDB(m1: MemberDB, m2: MemberDB) {
    // Normalize strings for comparison (case-insensitive, trimmed)
    const normalizeStr = (str: string | null): string => {
      return (str || "").toLowerCase().trim();
    };

    return (
      normalizeStr(m1.academicTitle) === normalizeStr(m2.academicTitle) &&
      normalizeStr(m1.firstName) === normalizeStr(m2.firstName) &&
      normalizeStr(m1.middleNames) === normalizeStr(m2.middleNames) &&
      normalizeStr(m1.baptismalName) === normalizeStr(m2.baptismalName) &&
      normalizeStr(m1.lastName) === normalizeStr(m2.lastName) &&
      m1.gender === m2.gender &&
      m1.dateOfBirth === m2.dateOfBirth &&
      m1.dateOfDeath === m2.dateOfDeath &&
      m1.deceased === m2.deceased
    );
  }
}

export interface MemberDB {
  id: string;
  gender: string;
  academicTitle: string | null;
  firstName: string;
  middleNames: string | null;
  baptismalName: string | null;
  lastName: string;
  maidenName: string | null;
  imageData: string | null;
  dateOfBirth: string;
  dateOfDeath: string | null;
  deceased: boolean;
  additionalData?: string | null;
  birthplace?: string | null;
  hometown?: string | null;
  placesLived?: string | null;
  isCollapsed: number;
  positionX: number;
  positionY: number;
  // Only present for members returned by virtual view endpoints.
  sourceTreeId?: string;
  sourceTreeName?: string;
  sourceTreeIds?: string[];
  sourceTreeNames?: string[];
  mergedFromIds?: string[];
  isMerged?: boolean;
}

export interface RelationDB {
  from_member_id: string;
  to_member_id: string;
  relation_type: string;
}

export interface MemberUpdate {
  gender?: Gender;
  academicTitle?: string | null;
  firstName?: string;
  middleNames?: string | null;
  baptismalName?: string | null;
  lastName?: string;
  maidenName?: string | null;
  imageData?: string;
  dateOfBirth?: string;
  dateOfDeath?: string | null;
  deceased?: boolean;
  paternalParentId?: string | null;
  maternalParentId?: string | null;
  additionalData?: string | null;
  birthplace?: string | null;
  hometown?: string | null;
  placesLived?: string | null;
  isCollapsed?: boolean;
  positionX?: number;
  positionY?: number;
}

function parsePlacesLived(raw: string | null | undefined): PlaceLived[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlaceLived[]) : [];
  } catch {
    return [];
  }
}

export function mapMemberFromDB(
  row: MemberDB,
  relations: RelationDB[] = [],
  diseases: Disease[] = [],
): Member {
  return {
    id: row.id,
    gender: (row.gender as Gender) || "o",
    academicTitle: row.academicTitle ?? null,
    firstName: row.firstName,
    middleNames: row.middleNames,
    baptismalName: row.baptismalName,
    lastName: row.lastName,
    maidenName: row.maidenName,
    imageData: row.imageData,
    deceased: !!row.deceased,
    date: {
      birth: row.dateOfBirth,
      death: row.dateOfDeath,
    },
    parents: {
      paternalParent: null,
      maternalParent: null,
    },
    additionalData: row.additionalData ?? null,
    birthplace: row.birthplace ?? null,
    hometown: row.hometown ?? null,
    placesLived: parsePlacesLived(row.placesLived),
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
    diseases: diseases,
    sourceTreeId: row.sourceTreeId,
    sourceTreeName: row.sourceTreeName,
    sourceTreeIds: row.sourceTreeIds,
    sourceTreeNames: row.sourceTreeNames,
    mergedFromIds: row.mergedFromIds,
    isMerged: row.isMerged,
  };
}

export function mapMemberToDB(member: Member): MemberDB {
  return {
    id: member.id,
    gender: member.gender,
    academicTitle: member.academicTitle ?? null,
    firstName: member.firstName,
    middleNames: member.middleNames,
    baptismalName: member.baptismalName,
    lastName: member.lastName,
    maidenName: member.maidenName,
    imageData: member.imageData,
    dateOfBirth: member.date.birth,
    dateOfDeath: member.date.death,
    deceased: member.deceased,
    positionX: member.position.x,
    positionY: member.position.y,
    additionalData: member.additionalData ? member.additionalData : null,
    birthplace: member.birthplace ?? null,
    hometown: member.hometown ?? null,
    placesLived:
      member.placesLived.length > 0 ? JSON.stringify(member.placesLived) : null,
    isCollapsed: member.isCollapsed ? 1 : 0,
  };
}

export function createMember(position: { x: number; y: number }): Member {
  const currentYear = new Date().getFullYear().toString();
  return {
    id: crypto.randomUUID(),
    gender: "o",
    academicTitle: null,
    firstName: "",
    middleNames: null,
    baptismalName: null,
    lastName: "",
    maidenName: null,
    imageData: null,
    deceased: false,
    date: { birth: currentYear, death: null },
    parents: { paternalParent: null, maternalParent: null },
    additionalData: null,
    birthplace: null,
    hometown: null,
    placesLived: [],
    isCollapsed: false,
    position: position,
  };
}
