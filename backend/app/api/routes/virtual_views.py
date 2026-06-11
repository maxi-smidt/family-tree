"""Virtual multi-tree views — read-only composites of 2+ trees."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import accessible_tree_ids, get_current_user, role_for
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Member, MemberDisease, Relation, RelationType, Tree, User
from app.models.virtual_view import VirtualView, VirtualViewSource
from app.schemas.family import DiseaseOut, MemberOut, RelationOut, RelationTypeOut
from app.schemas.virtual_view import (
    VirtualMemberOut,
    VirtualViewCreate,
    VirtualViewOut,
    VirtualViewSourceOut,
    VirtualViewUpdate,
)

router = APIRouter(prefix="/virtual-views", tags=["virtual-views"])

VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED = "virtual_view_source_access_revoked"
VIRTUAL_VIEW_SOURCES_MISSING = "virtual_view_sources_missing"


def _check_source_access(db: Session, view: VirtualView, user: User) -> None:
    """Raise 403/409 when the user has lost access to a source or too few remain."""
    if len(view.sources) < 2:
        raise HTTPException(status_code=409, detail=VIRTUAL_VIEW_SOURCES_MISSING)
    for src in view.sources:
        tree = db.get(Tree, src.tree_id)
        if tree is None or (not user.is_admin and role_for(db, tree, user) is None):
            raise HTTPException(
                status_code=403, detail=VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED
            )


def _resolve_view(db: Session, view_id: str, user: User) -> VirtualView:
    view = db.get(VirtualView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    _check_source_access(db, view, user)
    return view


def _view_out(db: Session, view: VirtualView, user: User) -> VirtualViewOut:
    accessible_ids = set(accessible_tree_ids(db, user))
    sources = [
        VirtualViewSourceOut(
            tree_id=src.tree_id,
            tree_name=(db.get(Tree, src.tree_id) or Tree(name="")).name,
            accessible=src.tree_id in accessible_ids,
        )
        for src in view.sources
    ]
    return VirtualViewOut(
        id=view.id,
        name=view.name,
        owner_id=view.owner_id,
        created_at=view.created_at,
        last_opened=view.last_opened,
        sources=sources,
    )


def _offset_members_by_source(
    rows: list[tuple[Member, str]], source_order: list[str]
) -> list[VirtualMemberOut]:
    """Apply horizontal offsets so trees don't overlap."""
    GAP = 600.0
    by_tree: dict[str, list[tuple[Member, str]]] = {}
    for m, tree_name in rows:
        by_tree.setdefault(m.tree_id, []).append((m, tree_name))

    x_offset = 0.0
    tree_offsets: dict[str, float] = {}
    for tree_id in source_order:
        if tree_id not in by_tree:
            continue
        members_in_tree = [m for m, _ in by_tree[tree_id]]
        tree_offsets[tree_id] = x_offset
        if members_in_tree:
            min_x = min(m.positionX for m in members_in_tree)
            max_x = max(m.positionX for m in members_in_tree)
            x_offset += (max_x - min_x) + GAP

    result: list[VirtualMemberOut] = []
    for tree_id, member_rows in by_tree.items():
        offset = tree_offsets.get(tree_id, 0.0)
        for m, tree_name in member_rows:
            out = MemberOut.model_validate(m).model_dump()
            out["positionX"] = m.positionX + offset
            result.append(
                VirtualMemberOut(
                    **out,
                    sourceTreeId=m.tree_id,
                    sourceTreeName=tree_name,
                )
            )
    return result


# --- CRUD on view configuration -------------------------------------------


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
        key=lambda v: (v.last_opened or "", v.created_at), reverse=True
    )
    return [_view_out(db, v, user) for v in views]


@router.post("", response_model=VirtualViewOut, status_code=201)
def create_virtual_view(
    payload: VirtualViewCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    unique_ids = list(dict.fromkeys(payload.source_tree_ids))
    if len(unique_ids) < 2:
        raise HTTPException(
            status_code=400, detail="At least 2 distinct source trees required"
        )
    accessible = set(accessible_tree_ids(db, user))
    for tree_id in unique_ids:
        if tree_id not in accessible:
            raise HTTPException(
                status_code=403,
                detail=f"No access to tree {tree_id}",
            )

    view = VirtualView(
        name=payload.name.strip(),
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    db.add(view)
    db.flush()
    for i, tree_id in enumerate(unique_ids):
        db.add(VirtualViewSource(view_id=view.id, tree_id=tree_id, position=i))
    db.commit()
    db.refresh(view)
    return _view_out(db, view, user)


@router.get("/{view_id}", response_model=VirtualViewOut)
def get_virtual_view(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    view = _resolve_view(db, view_id, user)
    view.last_opened = utcnow_iso()
    db.commit()
    return _view_out(db, view, user)


@router.patch("/{view_id}", response_model=VirtualViewOut)
def update_virtual_view(
    view_id: str,
    payload: VirtualViewUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    view = _resolve_view(db, view_id, user)
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can update a view")
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="A name is required")
        view.name = payload.name.strip()
    if payload.source_tree_ids is not None:
        unique_ids = list(dict.fromkeys(payload.source_tree_ids))
        if len(unique_ids) < 2:
            raise HTTPException(
                status_code=400, detail="At least 2 distinct source trees required"
            )
        accessible = set(accessible_tree_ids(db, user))
        for tree_id in unique_ids:
            if tree_id not in accessible:
                raise HTTPException(
                    status_code=403, detail=f"No access to tree {tree_id}"
                )
        for src in list(view.sources):
            db.delete(src)
        db.flush()
        for i, tree_id in enumerate(unique_ids):
            db.add(VirtualViewSource(view_id=view.id, tree_id=tree_id, position=i))
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
    db.delete(view)
    db.commit()


# --- Composite read endpoints -----------------------------------------------


@router.get("/{view_id}/metadata")
def get_virtual_view_metadata(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    view = _resolve_view(db, view_id, user)
    source_trees = [
        {"id": src.tree_id, "name": (db.get(Tree, src.tree_id) or Tree(name="")).name}
        for src in view.sources
    ]
    return {
        "id": view.id,
        "name": view.name,
        "createdAt": view.created_at,
        "lastOpened": view.last_opened,
        "sourceTrees": source_trees,
    }


@router.get("/{view_id}/members", response_model=list[VirtualMemberOut])
def list_virtual_members(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VirtualMemberOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = [s.tree_id for s in view.sources]
    rows = db.execute(
        select(Member, Tree.name)
        .join(Tree, Tree.id == Member.tree_id)
        .where(Member.tree_id.in_(source_ids))
    ).all()
    return _offset_members_by_source(
        [(m, name) for m, name in rows], source_ids
    )


@router.get("/{view_id}/relations", response_model=list[RelationOut])
def list_virtual_relations(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RelationOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = [s.tree_id for s in view.sources]
    return list(
        db.scalars(
            select(Relation).where(Relation.tree_id.in_(source_ids))
        ).all()
    )


@router.get("/{view_id}/diseases", response_model=list[DiseaseOut])
def list_virtual_diseases(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DiseaseOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = [s.tree_id for s in view.sources]
    member_ids = db.scalars(
        select(Member.id).where(Member.tree_id.in_(source_ids))
    ).all()
    return list(
        db.scalars(
            select(MemberDisease).where(MemberDisease.member_id.in_(member_ids))
        ).all()
    )


@router.get("/{view_id}/relation-types", response_model=list[RelationTypeOut])
def list_virtual_relation_types(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RelationTypeOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = [s.tree_id for s in view.sources]
    seen: set[str] = set()
    result: list[RelationTypeOut] = []
    for rt_id in db.scalars(
        select(RelationType.id).where(RelationType.tree_id.in_(source_ids))
    ).all():
        if rt_id not in seen:
            seen.add(rt_id)
            result.append(RelationTypeOut(id=rt_id))
    return result
