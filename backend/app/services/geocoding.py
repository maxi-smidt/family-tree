"""Geocoding via Nominatim (OpenStreetMap). No API key required."""

import logging
import time
from datetime import UTC, datetime

import httpx
from sqlalchemy.orm import Session

from app.models.content import GeocodeCache
from app.schemas.content import GeocodeOut

logger = logging.getLogger("app")

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_USER_AGENT = "FamilyTree/1.0 (self-hosted genealogy app)"
_REQUEST_DELAY = 1.1  # Nominatim policy: max 1 req/sec
_MAX_NEW_LOOKUPS = 50  # cap per batch call to respect usage policy


def _normalize(location: str) -> str:
    return " ".join(location.lower().split())


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _lookup_cached(db: Session, queries: list[str]) -> dict[str, GeocodeCache]:
    if not queries:
        return {}
    rows = db.query(GeocodeCache).filter(GeocodeCache.query.in_(queries)).all()
    return {row.query: row for row in rows}


def _geocode_one(query: str) -> tuple[float, float, str] | None:
    """Call Nominatim for a single query. Returns (lat, lon, display_name) or None."""
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                _NOMINATIM_URL,
                params={"format": "json", "limit": 1, "q": query},
                headers={"User-Agent": _USER_AGENT},
            )
            resp.raise_for_status()
            results = resp.json()
            if results:
                r = results[0]
                return float(r["lat"]), float(r["lon"]), r.get("display_name", "")
    except Exception:  # noqa: BLE001
        logger.warning("Geocoding failed for %r", query)
    return None


def resolve_batch(db: Session, locations: list[str]) -> list[GeocodeOut]:
    """Return coordinates for a list of location strings, geocoding unknown ones.

    Results are cached in ``geocode_cache`` so subsequent calls for the same
    location string are instant and never re-hit Nominatim.
    """
    # Map each original location to its normalized key
    normalized_map = {loc: _normalize(loc) for loc in locations if loc.strip()}
    # dedup while preserving order
    unique_normalized = list(dict.fromkeys(normalized_map.values()))

    cached = _lookup_cached(db, unique_normalized)
    to_geocode = [q for q in unique_normalized if q not in cached][: _MAX_NEW_LOOKUPS]

    for i, query in enumerate(to_geocode):
        result = _geocode_one(query)
        now = _now_iso()
        if result:
            lat, lon, display_name = result
            row = GeocodeCache(
                query=query, lat=lat, lon=lon,
                display_name=display_name, resolved=True, updated_at=now,
            )
        else:
            row = GeocodeCache(
                query=query, lat=None, lon=None,
                display_name=None, resolved=False, updated_at=now,
            )
        db.merge(row)
        cached[query] = row
        if i < len(to_geocode) - 1:
            time.sleep(_REQUEST_DELAY)

    if to_geocode:
        db.commit()

    # Build output: one entry per unique original location
    out: list[GeocodeOut] = []
    seen: set[str] = set()
    for loc in locations:
        if not loc.strip():
            continue
        norm = normalized_map[loc]
        if norm in seen:
            continue
        seen.add(norm)
        row = cached.get(norm)
        if row:
            out.append(
                GeocodeOut(
                    query=loc, lat=row.lat, lon=row.lon,
                    display_name=row.display_name, resolved=row.resolved,
                )
            )
        else:
            out.append(GeocodeOut(query=loc, resolved=False))
    return out


def resolve_single(db: Session, location: str) -> GeocodeOut:
    """Geocode a single location string, using the cache when possible."""
    results = resolve_batch(db, [location])
    return results[0] if results else GeocodeOut(query=location, resolved=False)
