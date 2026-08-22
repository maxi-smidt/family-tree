"""Geocode location strings via the backend-owned Nominatim cache."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import (
    get_readable_tree,
    get_writable_tree,
    require_domain,
    require_feature,
)
from app.db.session import get_db
from app.models import Tree
from app.schemas.content import (
    GeocodeCandidate,
    GeocodeOut,
    GeocodeOverrideRequest,
    GeocodeRequest,
)
from app.services.media.geocoding import (
    resolve_batch,
    resolve_single,
    search_candidates,
    set_override,
)

router = APIRouter(
    prefix="/trees/{tree_id}/geocode",
    tags=["geocode"],
    dependencies=[Depends(require_feature("map")), Depends(require_domain("map"))],
)


@router.post("", response_model=list[GeocodeOut])
def geocode_batch(
    payload: GeocodeRequest,
    _tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Resolve a batch of location strings to coordinates."""
    return resolve_batch(db, payload.locations)


@router.get("/preview", response_model=GeocodeOut)
def geocode_preview(
    q: str = Query(..., min_length=1),
    _tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Preview geocoding for a single location (used by EventDialog validation)."""
    return resolve_single(db, q)


@router.post("/override", response_model=GeocodeOut)
def geocode_override(
    payload: GeocodeOverrideRequest,
    _tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Store a manual correction for an unresolved (or misresolved) location.

    Mutates the global geocode cache, so this requires write access to the
    tree the request came from — not just read access.
    """
    return set_override(db, payload.query, payload.lat, payload.lon, payload.display_name)


@router.get("/search", response_model=list[GeocodeCandidate])
def geocode_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(5, ge=1, le=10),
    _tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Live Nominatim search for candidates matching an edited query string."""
    return search_candidates(db, q, limit)
