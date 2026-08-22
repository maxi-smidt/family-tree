"""Source-list validation and persistence for virtual-view configuration.

A view's ``source_tree_ids`` payload (from create/update) is a flat list of
real tree ids and/or nested ``vv_`` view ids. This module turns that untrusted
list into a validated, ordered ``[(kind, id), ...]`` — enforcing the ≥2
distinct sources rule, recursive read access to every underlying real tree,
and cycle rejection — and persists it as ``VirtualViewSource`` rows.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.deps import accessible_tree_ids
from app.models import User
from app.models.virtual_view import VirtualView, VirtualViewSource
from app.services.virtual_views.virtual_view_sources import flatten_tree_ids, view_closure

VIRTUAL_VIEW_SOURCE_CYCLE = "virtual_view_source_cycle"


def classify_and_validate_sources(
    db: Session,
    user: User,
    source_ids: list[str],
    target_view_id: str | None,
) -> list[tuple[str, str]]:
    """Validate a proposed source list; return ``[(kind, id), ...]`` in order.

    Accepts real tree ids and ``vv_`` view ids. Enforces the ≥2 distinct sources
    rule, recursive read access to every underlying real tree, and rejects
    cycles (``target_view_id`` may not appear in any source view's closure).
    Raises ``HTTPException`` on any problem.
    """
    unique_ids = list(dict.fromkeys(source_ids))
    if len(unique_ids) < 2:
        raise HTTPException(
            status_code=400, detail="At least 2 distinct source trees required"
        )
    accessible = set(accessible_tree_ids(db, user))
    resolved: list[tuple[str, str]] = []
    for sid in unique_ids:
        if sid.startswith("vv_"):
            nested = db.get(VirtualView, sid)
            if nested is None or (
                nested.owner_id != user.id and not user.is_admin
            ):
                raise HTTPException(
                    status_code=403, detail=f"No access to view {sid}"
                )
            if target_view_id is not None and target_view_id in view_closure(
                db, sid
            ):
                raise HTTPException(
                    status_code=409, detail=VIRTUAL_VIEW_SOURCE_CYCLE
                )
            for tid in flatten_tree_ids(db, nested):
                if tid not in accessible:
                    raise HTTPException(
                        status_code=403, detail=f"No access to tree {tid}"
                    )
            resolved.append(("view", sid))
        else:
            if sid not in accessible:
                raise HTTPException(
                    status_code=403, detail=f"No access to tree {sid}"
                )
            resolved.append(("tree", sid))
    return resolved


def flatten_resolved(db: Session, resolved: list[tuple[str, str]]) -> list[str]:
    """Ordered, de-duplicated real tree ids for a validated source list."""
    flat: list[str] = []
    for kind, sid in resolved:
        if kind == "tree":
            if sid not in flat:
                flat.append(sid)
        else:
            nested = db.get(VirtualView, sid)
            if nested is None:
                continue
            for tid in flatten_tree_ids(db, nested):
                if tid not in flat:
                    flat.append(tid)
    return flat


def persist_sources(
    db: Session, view: VirtualView, resolved: list[tuple[str, str]]
) -> None:
    """Replace a view's source rows from a validated ``[(kind, id)]`` list."""
    for i, (kind, sid) in enumerate(resolved):
        if kind == "tree":
            db.add(VirtualViewSource(view_id=view.id, position=i, tree_id=sid))
        else:
            db.add(
                VirtualViewSource(
                    view_id=view.id, position=i, source_view_id=sid
                )
            )
