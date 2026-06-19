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
    birthSort?: string | null;
    deathSort?: string | null;
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
      normalizeStr(m1.academic_title) === normalizeStr(m2.academic_title) &&
      normalizeStr(m1.first_name) === normalizeStr(m2.first_name) &&
      normalizeStr(m1.middle_names) === normalizeStr(m2.middle_names) &&
      normalizeStr(m1.baptismal_name) === normalizeStr(m2.baptismal_name) &&
      normalizeStr(m1.last_name) === normalizeStr(m2.last_name) &&
      m1.gender === m2.gender &&
      m1.date_of_birth === m2.date_of_birth &&
      m1.date_of_death === m2.date_of_death &&
      m1.deceased === m2.deceased
    );
  }
}

export interface MemberDB {
  id: string;
  gender: string;
  academic_title: string | null;
  first_name: string;
  middle_names: string | null;
  baptismal_name: string | null;
  last_name: string;
  maiden_name: string | null;
  image_data: string | null;
  date_of_birth: string;
  date_of_death: string | null;
  date_of_birth_sort?: string | null;
  date_of_death_sort?: string | null;
  deceased: boolean;
  additional_data?: string | null;
  birthplace?: string | null;
  hometown?: string | null;
  places_lived?: string | null;
  is_collapsed: number;
  position_x: number;
  position_y: number;
  // Only present for members returned by virtual view endpoints.
  source_tree_id?: string;
  source_tree_name?: string;
  source_tree_ids?: string[];
  source_tree_names?: string[];
  merged_from_ids?: string[];
  is_merged?: boolean;
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
    academicTitle: row.academic_title ?? null,
    firstName: row.first_name,
    middleNames: row.middle_names,
    baptismalName: row.baptismal_name,
    lastName: row.last_name,
    maidenName: row.maiden_name,
    imageData: row.image_data,
    deceased: !!row.deceased,
    date: {
      birth: row.date_of_birth,
      death: row.date_of_death,
      birthSort: row.date_of_birth_sort ?? null,
      deathSort: row.date_of_death_sort ?? null,
    },
    parents: {
      paternalParent: null,
      maternalParent: null,
    },
    additionalData: row.additional_data ?? null,
    birthplace: row.birthplace ?? null,
    hometown: row.hometown ?? null,
    placesLived: parsePlacesLived(row.places_lived),
    isCollapsed: !!row.is_collapsed,
    position: {
      x: row.position_x,
      y: row.position_y,
    },
    relations: relations.map((r) => ({
      fromMemberId: r.from_member_id,
      toMemberId: r.to_member_id,
      relationType: r.relation_type as RelationType,
    })),
    diseases: diseases,
    sourceTreeId: row.source_tree_id,
    sourceTreeName: row.source_tree_name,
    sourceTreeIds: row.source_tree_ids,
    sourceTreeNames: row.source_tree_names,
    mergedFromIds: row.merged_from_ids,
    isMerged: row.is_merged,
  };
}

export function mapMemberToDB(member: Member): MemberDB {
  return {
    id: member.id,
    gender: member.gender,
    academic_title: member.academicTitle ?? null,
    first_name: member.firstName,
    middle_names: member.middleNames,
    baptismal_name: member.baptismalName,
    last_name: member.lastName,
    maiden_name: member.maidenName,
    image_data: member.imageData,
    date_of_birth: member.date.birth,
    date_of_death: member.date.death,
    deceased: member.deceased,
    position_x: member.position.x,
    position_y: member.position.y,
    additional_data: member.additionalData ? member.additionalData : null,
    birthplace: member.birthplace ?? null,
    hometown: member.hometown ?? null,
    places_lived:
      member.placesLived.length > 0 ? JSON.stringify(member.placesLived) : null,
    is_collapsed: member.isCollapsed ? 1 : 0,
  };
}

/**
 * Map a partial domain-level member update (camelCase) to the snake_case wire
 * payload accepted by the API. Only the keys present in `changes` are emitted.
 */
export function mapMemberUpdateToDB(
  changes: Omit<MemberUpdate, "paternalParentId" | "maternalParentId">,
): Record<string, unknown> {
  const keyMap: Record<string, string> = {
    gender: "gender",
    academicTitle: "academic_title",
    firstName: "first_name",
    middleNames: "middle_names",
    baptismalName: "baptismal_name",
    lastName: "last_name",
    maidenName: "maiden_name",
    imageData: "image_data",
    dateOfBirth: "date_of_birth",
    dateOfDeath: "date_of_death",
    deceased: "deceased",
    additionalData: "additional_data",
    birthplace: "birthplace",
    hometown: "hometown",
    placesLived: "places_lived",
    isCollapsed: "is_collapsed",
    positionX: "position_x",
    positionY: "position_y",
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    out[keyMap[key] ?? key] = value;
  }
  return out;
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
