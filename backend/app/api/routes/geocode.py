"""Geocode location strings via the backend-owned Nominatim cache."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, require_feature
from app.db.session import get_db
from app.models import Tree
from app.schemas.content import GeocodeOut, GeocodeRequest
from app.services.geocoding import resolve_batch, resolve_single

router = APIRouter(
    prefix="/trees/{tree_id}/geocode",
    tags=["geocode"],
    dependencies=[Depends(require_feature("map"))],
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
