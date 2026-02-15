export interface Database {
  id: string;
  name: string;
}

export interface InspectDatabaseResult {
  encrypted: boolean;
  passwordRequired: boolean;
  id: string | null;
  name: string | null;
}
