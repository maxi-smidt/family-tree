"""Relation edges between members — scoped to a tree."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree_public, get_writable_tree
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.session import get_db
from app.models import Member, Relation, RelationType, Tree
from app.models.user import User
from app.schemas.family import RelationCreate, RelationOut
from app.services.activity import record_activity, relation_delete_snapshot
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.storage_usage import check_tree_quota

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])


@router.get("/relations", response_model=list[RelationOut])
def list_relations(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree_public),
    db: Session = Depends(get_db),
):
    statement = (
        select(Relation)
        .where(Relation.tree_id == tree.id)
        .order_by(
            Relation.from_member_id,
            Relation.to_member_id,
            Relation.relation_type,
        )
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/relations", response_model=RelationOut, status_code=201)
def add_relation(
    payload: RelationCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from_member = db.scalar(
        select(Member).where(
            Member.id == payload.from_member_id, Member.tree_id == tree.id
        )
    )
    if from_member is None:
        raise HTTPException(
            status_code=404, detail="from_member_id not found in this tree"
        )
    to_member = db.scalar(
        select(Member).where(Member.id == payload.to_member_id, Member.tree_id == tree.id)
    )
    if to_member is None:
        raise HTTPException(status_code=404, detail="to_member_id not found in this tree")
    if db.get(RelationType, payload.relation_type) is None:
        raise HTTPException(status_code=404, detail="Unknown relation_type")

    key = (tree.id, payload.from_member_id, payload.to_member_id, payload.relation_type)
    relation = db.get(Relation, key)
    if relation is None:
        check_tree_quota(db, tree, len(str(payload.model_dump()).encode()))
        relation = Relation(tree_id=tree.id, **payload.model_dump())
        db.add(relation)
        label = (
            f"{payload.from_member_id} → {payload.to_member_id} ({payload.relation_type})"
        )
        record_activity(
            db,
            tree_id=tree.id,
            actor=user,
            action="create",
            target_type="relation",
            target_label=label,
        )
        db.commit()
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        publish_tree_event(
            db,
            tree,
            "tree.content_changed",
            {"tree_id": tree.id, "domain": "member"},
        )
        invalidate_stats(tree.id)
    return relation


@router.delete("/relations", status_code=204)
def remove_relation(
    from_member_id: str,
    to_member_id: str,
    relation_type: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    relation = db.get(Relation, (tree.id, from_member_id, to_member_id, relation_type))
    if relation is not None:
        label = f"{from_member_id} → {to_member_id} ({relation_type})"
        record_activity(
            db,
            tree_id=tree.id,
            actor=user,
            action="delete",
            target_type="relation",
            target_label=label,
            details=relation_delete_snapshot(relation),
        )
        db.delete(relation)
        db.commit()
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        publish_tree_event(
            db,
            tree,
            "tree.content_changed",
            {"tree_id": tree.id, "domain": "member"},
        )
        invalidate_stats(tree.id)
