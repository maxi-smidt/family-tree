"""Resolve a virtual view's source DAG to the underlying real trees.

A virtual view's sources may be real trees *or* other virtual views. The whole
feature treats nesting as sugar: a single flatten pass expands the DAG into an
ordered, de-duplicated list of real ``tree_id``s, and everything else (matching,
composite members / relations / diseases, and the parity feature endpoints)
operates on that flattened set. So a view over ``{A, vv1}`` with ``vv1 = {B, C}``
behaves exactly like ``{A, B, C}``.

All traversal is cycle-safe; cycles are rejected at write time (see the router),
so raising here is purely defensive.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.virtual_view import VirtualView


class VirtualViewCycleError(Exception):
    """Raised when a virtual view's sources would form a cycle."""


def flatten_tree_ids(
    db: Session, view: VirtualView, _seen: set[str] | None = None
) -> list[str]:
    """Ordered, de-duplicated real tree ids underlying *view*.

    Expands nested virtual-view sources depth-first in source order; a real tree
    reached via multiple paths appears once, at its first occurrence (this order
    drives ``source_order`` / primary-member selection downstream). Missing
    sources (deleted tree/view rows) contribute nothing.

    ``_seen`` tracks the current traversal path so genuine cycles raise while
    diamonds (a view reached by two distinct paths) are merely de-duplicated.
    """
    if _seen is None:
        _seen = set()
    if view.id in _seen:
        raise VirtualViewCycleError(view.id)
    _seen.add(view.id)

    result: list[str] = []
    for src in view.sources:
        if src.tree_id is not None:
            if src.tree_id not in result:
                result.append(src.tree_id)
        elif src.source_view_id is not None:
            nested = db.get(VirtualView, src.source_view_id)
            if nested is None:
                continue
            for tid in flatten_tree_ids(db, nested, _seen):
                if tid not in result:
                    result.append(tid)
    _seen.discard(view.id)
    return result


def view_closure(
    db: Session, view_id: str, _seen: set[str] | None = None
) -> set[str]:
    """All virtual-view ids reachable from *view_id*, inclusive of itself.

    Used to reject cycles before they are persisted: a view ``V`` may not list a
    source view ``W`` when ``V`` is anywhere in ``W``'s closure.
    """
    if _seen is None:
        _seen = set()
    if view_id in _seen:
        return _seen
    _seen.add(view_id)
    view = db.get(VirtualView, view_id)
    if view is None:
        return _seen
    for src in view.sources:
        if src.source_view_id is not None:
            view_closure(db, src.source_view_id, _seen)
    return _seen
