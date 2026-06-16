export interface GeocodeDB {
  query: string;
  lat: number | null;
  lon: number | null;
  display_name: string | null;
  resolved: boolean;
}

export interface GeocodeResult {
  query: string;
  lat: number | null;
  lon: number | null;
  displayName: string | null;
  resolved: boolean;
}

export function mapGeocodeFromDB(row: GeocodeDB): GeocodeResult {
  return {
    query: row.query,
    lat: row.lat,
    lon: row.lon,
    displayName: row.display_name,
    resolved: row.resolved,
  };
}
