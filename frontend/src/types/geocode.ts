export interface GeocodeDB {
  query: string;
  lat: number | null;
  lon: number | null;
  display_name: string | null;
  resolved: boolean;
  manual: boolean;
}

export interface GeocodeResult {
  query: string;
  lat: number | null;
  lon: number | null;
  displayName: string | null;
  resolved: boolean;
  manual: boolean;
}

export function mapGeocodeFromDB(row: GeocodeDB): GeocodeResult {
  return {
    query: row.query,
    lat: row.lat,
    lon: row.lon,
    displayName: row.display_name,
    resolved: row.resolved,
    manual: row.manual,
  };
}

// A live Nominatim search result (never cached); used by the manual
// geocode-correction UI to let the user pick a suggestion for an edited
// query string.
export interface GeocodeCandidate {
  lat: number;
  lon: number;
  display_name: string;
}
