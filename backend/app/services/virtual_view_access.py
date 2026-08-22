"""Ownership + source-access resolution shared by the virtual-view routers.

A virtual view is only usable while its owner (or an admin) still has read
access to every underlying source — a real tree share can be revoked, or a
nested view's owner can lose access to one of *its* sources, after the view
was created. ``resolve_view`` is the single choke point both the
configuration routes and the composite content routes call before doing
anything else.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.db.base import utcnow_iso
from app.db.upsert import upsert_row
from app.models import Tree, User
from app.models.virtual_view import VirtualView, VirtualViewUserState

VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED = "virtual_view_source_access_revoked"
VIRTUAL_VIEW_SOURCES_MISSING = "virtual_view_sources_missing"


def check_source_access(
    db: Session, view: VirtualView, user: User, _seen: set[str] | None = None
) -> None:
    """Raise 403/409 when the user has lost access to a source or too few remain.

    Recurses through nested virtual-view sources: every underlying real tree
    must still be readable and every nested view resolvable and owned by the
    user (admins bypass).
    """
    if _seen is None:
        _seen = set()
    if view.id in _seen:
        return  # defensive: cycles are rejected at write time
    _seen.add(view.id)

    if len(view.sources) < 2:
        raise HTTPException(status_code=409, detail=VIRTUAL_VIEW_SOURCES_MISSING)
    for src in view.sources:
        if src.tree_id is not None:
            tree = db.get(Tree, src.tree_id)
            if tree is None or (
                not user.is_admin and role_for(db, tree, user) is None
            ):
                raise HTTPException(
                    status_code=403, detail=VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED
                )
        else:
            nested = db.get(VirtualView, src.source_view_id)
            if nested is None:
                raise HTTPException(
                    status_code=409, detail=VIRTUAL_VIEW_SOURCES_MISSING
                )
            if nested.owner_id != user.id and not user.is_admin:
                raise HTTPException(
                    status_code=403, detail=VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED
                )
            check_source_access(db, nested, user, _seen)


def resolve_view(db: Session, view_id: str, user: User) -> VirtualView:
    view = db.get(VirtualView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    check_source_access(db, view, user)
    return view


def mark_view_opened(db: Session, view_id: str, user_id: str) -> None:
    """Stamp ``view_id`` as just-opened for ``user_id`` (#878: an admin
    opening someone else's view must not reorder the owner's own list)."""
    upsert_row(
        db,
        VirtualViewUserState,
        {"view_id": view_id, "user_id": user_id, "last_opened": utcnow_iso()},
        index_elements=["view_id", "user_id"],
    )


def view_last_opened(db: Session, view_id: str, user_id: str) -> str | None:
    state = db.get(VirtualViewUserState, (view_id, user_id))
    return state.last_opened if state else None
