export interface Database {
  id: string;
  name: string;
}

export interface InspectDatabaseResult {
  encrypted: boolean;
  id: string | null;
  name: string | null;
}
