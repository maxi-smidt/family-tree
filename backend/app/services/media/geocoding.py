"""Geocoding via Nominatim (OpenStreetMap). No API key required."""

import logging
import time
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from app.models.content import GeocodeCache
from app.schemas.content import GeocodeCandidate, GeocodeOut
from app.services.unit_of_work import UnitOfWork

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
    if row.resolved or row.manual:
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
        q
        for q in unique_normalized
        if q not in cached or (not cached[q].manual and _is_retryable(cached[q]))
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
                    display_name=display_name, resolved=True, manual=False,
                    updated_at=_now_iso(),
                )
            else:
                row = GeocodeCache(
                    query=query, lat=None, lon=None,
                    display_name=None, resolved=False, manual=False,
                    updated_at=_now_iso(),
                )
            db.merge(row)
            cached[query] = row
            wrote = True
        if i < len(to_geocode) - 1:
            time.sleep(_REQUEST_DELAY)

    if wrote:
        with UnitOfWork(db):
            pass

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
                    manual=row.manual,
                )
            )
        else:
            out.append(GeocodeOut(query=loc, resolved=False))
    return out


def resolve_single(db: Session, location: str) -> GeocodeOut:
    """Geocode a single location string, using the cache when possible."""
    results = resolve_batch(db, [location])
    return results[0] if results else GeocodeOut(query=location, resolved=False)


def set_override(
    db: Session, query: str, lat: float, lon: float, display_name: str | None
) -> GeocodeOut:
    """Store a user-supplied correction for ``query`` in the global cache.

    Marked ``manual=True`` so resolve_batch never re-geocodes or overwrites
    it. The cache key is the normalized query, but the returned GeocodeOut
    echoes back the caller's original (un-normalized) string so the frontend
    map — keyed by the original location text — can look it up directly.
    """
    normalized = _normalize(query)
    row = GeocodeCache(
        query=normalized,
        lat=lat,
        lon=lon,
        display_name=display_name,
        resolved=True,
        manual=True,
        updated_at=_now_iso(),
    )
    with UnitOfWork(db):
        db.merge(row)
    return GeocodeOut(
        query=query, lat=lat, lon=lon, display_name=display_name,
        resolved=True, manual=True,
    )


def search_candidates(db: Session, query: str, limit: int = 5) -> list[GeocodeCandidate]:
    """Live Nominatim search for candidates matching ``query`` (not cached).

    Used by the manual-correction UI so the user can pick from several
    suggestions for an edited search string. Returns an empty list on
    failure instead of raising, since this is a best-effort lookup driven
    directly by user interaction (not a batch/background job).
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                _NOMINATIM_URL,
                params={"format": "json", "limit": limit, "q": query},
                headers={"User-Agent": _USER_AGENT},
            )
            resp.raise_for_status()
            results = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Geocode search failed for %r: %s", query, exc)
        return []

    return [
        GeocodeCandidate(
            lat=float(r["lat"]),
            lon=float(r["lon"]),
            display_name=r.get("display_name", ""),
        )
        for r in results
    ]
