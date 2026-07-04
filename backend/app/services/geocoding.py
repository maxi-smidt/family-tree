"""Geocoding via Nominatim (OpenStreetMap). No API key required."""

import logging
import time
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from app.models.content import GeocodeCache
from app.schemas.content import GeocodeOut

logger = logging.getLogger("app")

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_USER_AGENT = "FamilyTree/1.0 (self-hosted genealogy app)"
_REQUEST_DELAY = 1.1  # Nominatim policy: max 1 req/sec
_MAX_NEW_LOOKUPS = 50  # cap per batch call to respect usage policy
# "No results" answers are cached but re-attempted occasionally: OSM data
# improves and users fix typos in cached-forever strings otherwise stay dead.
_UNRESOLVED_RETRY = timedelta(days=7)


class GeocodeUnavailableError(Exception):
    """Nominatim could not be queried (timeout, 429, 5xx, malformed reply)."""


def _normalize(location: str) -> str:
    return " ".join(location.lower().split())


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _lookup_cached(db: Session, queries: list[str]) -> dict[str, GeocodeCache]:
    if not queries:
        return {}
    rows = db.query(GeocodeCache).filter(GeocodeCache.query.in_(queries)).all()
    return {row.query: row for row in rows}


def _is_retryable(row: GeocodeCache) -> bool:
    """True for unresolved cache rows old enough to try Nominatim again."""
    if row.resolved:
        return False
    try:
        updated = datetime.fromisoformat(row.updated_at)
    except (TypeError, ValueError):
        return True
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=UTC)
    return datetime.now(UTC) - updated >= _UNRESOLVED_RETRY


def _geocode_one(query: str) -> tuple[float, float, str] | None:
    """Call Nominatim for a single query.

    Returns (lat, lon, display_name), or None when Nominatim answered but had
    no results. Raises GeocodeUnavailableError when the request itself failed,
    so transient errors are never mistaken for "this place does not exist".
    """
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
            return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Geocoding request failed for %r: %s", query, exc)
        raise GeocodeUnavailableError(query) from exc


def resolve_batch(db: Session, locations: list[str]) -> list[GeocodeOut]:
    """Return coordinates for a list of location strings, geocoding unknown ones.

    Results are cached in ``geocode_cache``. Successful lookups never re-hit
    Nominatim; "no results" answers are cached too but retried after
    ``_UNRESOLVED_RETRY``; failed requests (timeout, 429, ...) are not cached
    at all, so the next call retries them immediately.
    """
    # Map each original location to its normalized key
    normalized_map = {loc: _normalize(loc) for loc in locations if loc.strip()}
    # dedup while preserving order
    unique_normalized = list(dict.fromkeys(normalized_map.values()))

    cached = _lookup_cached(db, unique_normalized)
    to_geocode = [
        q for q in unique_normalized if q not in cached or _is_retryable(cached[q])
    ][:_MAX_NEW_LOOKUPS]

    wrote = False
    for i, query in enumerate(to_geocode):
        try:
            result = _geocode_one(query)
        except GeocodeUnavailableError:
            # Not cached: the next call retries immediately. A stale unresolved
            # row (if any) is left untouched and stays retryable.
            pass
        else:
            if result:
                lat, lon, display_name = result
                row = GeocodeCache(
                    query=query, lat=lat, lon=lon,
                    display_name=display_name, resolved=True, updated_at=_now_iso(),
                )
            else:
                row = GeocodeCache(
                    query=query, lat=None, lon=None,
                    display_name=None, resolved=False, updated_at=_now_iso(),
                )
            db.merge(row)
            cached[query] = row
            wrote = True
        if i < len(to_geocode) - 1:
            time.sleep(_REQUEST_DELAY)

    if wrote:
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
