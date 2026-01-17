export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  imageData: string | null;
  date: {
    birth: string;
    death: string | null;
  };
  parents: {
    first: string | null;
    second: string | null;
  };
  additionalData: string | null;
  position: {
    x: number;
    y: number;
  };
  [key: string]: unknown;
}

export interface MemberDB {
  id: string;
  firstName: string;
  lastName: string;
  imageData: string | null;
  dateOfBirth: string;
  dateOfDeath: string | null;
  firstParentId: string | null;
  secondParentId: string | null;
  additionalData: string | null;
  positionX: number;
  positionY: number;
}

export interface MemberUpdate {
  firstName?: string;
  lastName?: string;
  imageData?: string;
  dateOfBirth?: string;
  dateOfDeath?: string;
  firstParentId?: string;
  secondParentId?: string;
  additionalData?: string;
  positionX?: number;
  positionY?: number;
}

export function mapMemberFromDB(row: MemberDB): Member {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    imageData: row.imageData,
    date: {
      birth: row.dateOfBirth,
      death: row.dateOfDeath,
    },
    parents: {
      first: row.firstParentId,
      second: row.secondParentId,
    },
    additionalData: row.additionalData,
    position: {
      x: row.positionX,
      y: row.positionY,
    },
  };
}

export function mapMemberToDB(member: Member): MemberDB {
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    imageData: member.imageData,
    dateOfBirth: member.date.birth,
    dateOfDeath: member.date.death,
    firstParentId: member.parents.first,
    secondParentId: member.parents.second,
    positionX: member.position.x,
    positionY: member.position.y,
    additionalData: member.additionalData ? member.additionalData : null,
  };
}
