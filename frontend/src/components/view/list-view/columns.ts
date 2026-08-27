export type ListColumnId =
  | "photo"
  | "firstName"
  | "lastName"
  | "maidenName"
  | "gender"
  | "birth"
  | "death"
  | "birthplace"
  | "hometown"
  | "cemetery"
  | "age"
  | "childrenCount"
  | "status";

export const ALL_COLUMN_IDS: ListColumnId[] = [
  "photo",
  "firstName",
  "lastName",
  "maidenName",
  "gender",
  "birth",
  "death",
  "birthplace",
  "hometown",
  "cemetery",
  "age",
  "childrenCount",
  "status",
];

export const DEFAULT_HIDDEN_COLUMNS: ListColumnId[] = [
  "photo",
  "hometown",
  "cemetery",
  "age",
  "childrenCount",
  "status",
];

export interface ColumnDef {
  titleKey: string;
  sortable?: boolean;
  sortKey?: string;
}

export const COLUMN_MAP: Record<ListColumnId, ColumnDef> = {
  photo: { titleKey: "table.photo" },
  firstName: {
    titleKey: "table.first-name",
    sortable: true,
    sortKey: "firstName",
  },
  lastName: {
    titleKey: "table.last-name",
    sortable: true,
    sortKey: "lastName",
  },
  maidenName: { titleKey: "table.maiden-name" },
  gender: { titleKey: "table.gender" },
  birth: { titleKey: "table.dob", sortable: true, sortKey: "date.birth" },
  death: { titleKey: "table.dod", sortable: true, sortKey: "date.death" },
  birthplace: { titleKey: "table.birthplace" },
  hometown: { titleKey: "table.hometown" },
  cemetery: { titleKey: "table.cemetery" },
  age: { titleKey: "table.age", sortable: true, sortKey: "age" },
  childrenCount: {
    titleKey: "table.children",
    sortable: true,
    sortKey: "childrenCount",
  },
  status: { titleKey: "table.status" },
};
