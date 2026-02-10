export type Gender = "male" | "female" | "other";

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
  paternalParentId: string | null;
  maternalParentId: string | null;
  additionalData: string | null;
  isCollapsed: number;
  positionX: number;
  positionY: number;
}

export interface MemberUpdate {
  gender?: Gender;
  firstName?: string;
  lastName?: string;
  maidenName?: string;
  imageData?: string;
  dateOfBirth?: string;
  dateOfDeath?: string;
  paternalParentId?: string;
  maternalParentId?: string;
  additionalData?: string;
  isCollapsed?: boolean;
  positionX?: number;
  positionY?: number;
}

export function mapMemberFromDB(row: MemberDB): Member {
  return {
    id: row.id,
    gender: (row.gender as Gender) || "other",
    firstName: row.firstName,
    lastName: row.lastName,
    maidenName: row.maidenName,
    imageData: row.imageData,
    date: {
      birth: row.dateOfBirth,
      death: row.dateOfDeath,
    },
    parents: {
      paternalParent: row.paternalParentId,
      maternalParent: row.maternalParentId,
    },
    additionalData: row.additionalData,
    isCollapsed: !!row.isCollapsed,
    position: {
      x: row.positionX,
      y: row.positionY,
    },
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
    paternalParentId: member.parents.paternalParent,
    maternalParentId: member.parents.maternalParent,
    positionX: member.position.x,
    positionY: member.position.y,
    additionalData: member.additionalData ? member.additionalData : null,
    isCollapsed: member.isCollapsed ? 1 : 0,
  };
}
