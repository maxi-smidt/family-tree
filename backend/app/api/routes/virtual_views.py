"""Virtual multi-tree views — configuration CRUD.

Composite read endpoints (members/relations/gallery/statistics/…) live in
``virtual_view_content.py``; this module owns the view's own configuration:
name, source list, and match recomputation.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import accessible_tree_ids, get_current_user, require_feature
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Tree, User
from app.models.virtual_view import VirtualView, VirtualViewMemberMatch, VirtualViewSource
from app.schemas.virtual_view import (
    RecomputeMatchesResult,
    VirtualViewCreate,
    VirtualViewOut,
    VirtualViewSourceOut,
    VirtualViewUpdate,
)
from app.services.admin_audit import record_admin_audit
from app.services.virtual_views.virtual_view_access import (
    mark_view_opened,
    resolve_view,
    view_last_opened,
)
from app.services.virtual_views.virtual_view_config import (
    classify_and_validate_sources,
    flatten_resolved,
    persist_sources,
)
from app.services.virtual_views.virtual_view_matching import (
    compute_match_groups,
    persist_matches,
)

router = APIRouter(
    prefix="/virtual-views",
    tags=["virtual-views"],
    dependencies=[Depends(require_feature("virtual_views"))],
)

VIRTUAL_VIEW_SOURCES_NO_OVERLAP = "virtual_view_sources_no_overlap"


def _source_out(
    db: Session,
    src: VirtualViewSource,
    user: User,
    accessible_ids: set[str],
) -> VirtualViewSourceOut:
    """Describe one configured source (a real tree or a nested virtual view)."""
    if src.tree_id is not None:
        tree = db.get(Tree, src.tree_id)
        return VirtualViewSourceOut(
            tree_id=src.tree_id,
            tree_name=(tree or Tree(name="")).name,
            accessible=src.tree_id in accessible_ids,
            kind="tree",
            is_virtual=False,
        )
    nested = db.get(VirtualView, src.source_view_id or "")
    accessible = nested is not None and (
        nested.owner_id == user.id or user.is_admin
    )
    return VirtualViewSourceOut(
        tree_id=src.source_view_id or "",
        tree_name=nested.name if nested else "",
        accessible=accessible,
        kind="view",
        is_virtual=True,
    )


def _view_out(
    db: Session, view: VirtualView, user: User, accessible_ids: set[str] | None = None
) -> VirtualViewOut:
    if accessible_ids is None:
        accessible_ids = set(accessible_tree_ids(db, user))
    sources = [
        _source_out(db, src, user, accessible_ids) for src in view.sources
    ]
    return VirtualViewOut(
        id=view.id,
        name=view.name,
        owner_id=view.owner_id,
        created_at=view.created_at,
        last_opened=view_last_opened(db, view.id, user.id),
        sources=sources,
    )


@router.get("", response_model=list[VirtualViewOut])
def list_virtual_views(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VirtualViewOut]:
    if user.is_admin:
        views = list(db.scalars(select(VirtualView)).all())
    else:
        views = list(
            db.scalars(
                select(VirtualView).where(VirtualView.owner_id == user.id)
            ).all()
        )
    views.sort(
        key=lambda v: (view_last_opened(db, v.id, user.id) or "", v.created_at),
        reverse=True,
    )
    accessible_ids = set(accessible_tree_ids(db, user))
    return [_view_out(db, v, user, accessible_ids) for v in views]


@router.post("", response_model=VirtualViewOut, status_code=201)
def create_virtual_view(
    payload: VirtualViewCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    resolved = classify_and_validate_sources(
        db, user, payload.source_tree_ids, target_view_id=None
    )
    groups = compute_match_groups(db, flatten_resolved(db, resolved))
    if not groups:
        raise HTTPException(
            status_code=409, detail=VIRTUAL_VIEW_SOURCES_NO_OVERLAP
        )

    view = VirtualView(
        name=payload.name.strip(),
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    db.add(view)
    db.flush()
    persist_sources(db, view, resolved)
    db.flush()
    persist_matches(db, view)
    record_admin_audit(
        db, actor=user, action="create", subject_type="virtual_view",
        subject_id=view.id, subject_label=view.name,
        details={"source_ids": payload.source_tree_ids},
    )
    db.commit()
    db.refresh(view)
    return _view_out(db, view, user)


@router.get("/{view_id}", response_model=VirtualViewOut)
def get_virtual_view(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    view = resolve_view(db, view_id, user)
    mark_view_opened(db, view.id, user.id)
    db.commit()
    return _view_out(db, view, user)


@router.patch("/{view_id}", response_model=VirtualViewOut)
def update_virtual_view(
    view_id: str,
    payload: VirtualViewUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    view = resolve_view(db, view_id, user)
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can update a view")
    before = {
        "name": view.name,
        "source_ids": [src.tree_id or src.source_view_id for src in view.sources],
    }
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="A name is required")
        view.name = payload.name.strip()
    if payload.source_tree_ids is not None:
        resolved = classify_and_validate_sources(
            db, user, payload.source_tree_ids, target_view_id=view.id
        )
        groups = compute_match_groups(db, flatten_resolved(db, resolved))
        if not groups:
            raise HTTPException(
                status_code=409, detail=VIRTUAL_VIEW_SOURCES_NO_OVERLAP
            )
        for src in list(view.sources):
            db.delete(src)
        db.flush()
        persist_sources(db, view, resolved)
        db.flush()
        # The sources relationship was loaded before the delete/re-add above;
        # expire it so persist_matches sees the new source list, not the stale
        # collection (otherwise matches are computed against the old trees).
        db.expire(view, ["sources"])
        persist_matches(db, view)
    if payload.name is not None or payload.source_tree_ids is not None:
        after = {
            "name": view.name,
            "source_ids": (
                payload.source_tree_ids
                if payload.source_tree_ids is not None
                else before["source_ids"]
            ),
        }
        record_admin_audit(
            db, actor=user, action="update", subject_type="virtual_view",
            subject_id=view.id, subject_label=view.name,
            details={"before": before, "after": after},
        )
    db.commit()
    db.refresh(view)
    return _view_out(db, view, user)


@router.delete("/{view_id}", status_code=204)
def delete_virtual_view(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    view = db.get(VirtualView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can delete a view")
    record_admin_audit(
        db, actor=user, action="delete", subject_type="virtual_view",
        subject_id=view.id, subject_label=view.name,
    )
    db.delete(view)
    db.commit()


@router.post("/{view_id}/recompute-matches", response_model=RecomputeMatchesResult)
def recompute_matches(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RecomputeMatchesResult:
    view = resolve_view(db, view_id, user)
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can recompute matches"
        )
    group_count = persist_matches(db, view)
    db.commit()
    merged_count = len(
        db.execute(
            select(VirtualViewMemberMatch.member_id).where(
                VirtualViewMemberMatch.view_id == view_id
            )
        ).fetchall()
    )
    return RecomputeMatchesResult(
        group_count=group_count, merged_member_count=merged_count
    )
