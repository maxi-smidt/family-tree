"""Member disease records — scoped to a tree."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_writable_tree,
    require_domain,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.session import get_db
from app.models import MemberDisease, Tree
from app.models.user import User
from app.schemas.family import DiseaseCreate, DiseaseOut, DiseaseUpdate
from app.services.activity.activity import disease_delete_snapshot, record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.member_access import get_member
from app.services.storage_usage import check_tree_quota

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])


@router.get(
    "/diseases",
    response_model=list[DiseaseOut],
    dependencies=[Depends(require_domain("diseases"))],
)
def list_diseases(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(MemberDisease)
        .where(MemberDisease.tree_id == tree.id)
        .order_by(MemberDisease.id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post(
    "/diseases",
    response_model=DiseaseOut,
    status_code=201,
    dependencies=[Depends(require_domain("diseases"))],
)
def add_disease(
    payload: DiseaseCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_member(db, tree, payload.member_id)
    check_tree_quota(db, tree, len(str(payload.model_dump()).encode()))
    disease = MemberDisease(tree_id=tree.id, **payload.model_dump())
    db.add(disease)
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="create",
        target_type="disease",
        target_label=payload.name,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(disease)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
    return disease


@router.patch(
    "/diseases/{disease_id}",
    response_model=DiseaseOut,
    dependencies=[Depends(require_domain("diseases"))],
)
def update_disease(
    disease_id: str,
    payload: DiseaseUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    for key, value in payload.model_dump().items():
        setattr(disease, key, value)
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="disease",
        target_id=disease_id,
        target_label=disease.name,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(disease)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
    return disease


@router.delete(
    "/diseases/{disease_id}",
    status_code=204,
    dependencies=[Depends(require_domain("diseases"))],
)
def delete_disease(
    disease_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="delete",
        target_type="disease",
        target_id=disease_id,
        target_label=disease.name,
        details=disease_delete_snapshot(disease),
    )
    db.delete(disease)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
