"""Relation edges between members — scoped to a tree."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace_public,
    get_writable_workspace,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.session import get_db
from app.models import Member, Relation, RelationType, Workspace
from app.models.user import User
from app.schemas.family import RelationCreate, RelationOut
from app.services.activity.activity import record_activity, relation_delete_snapshot
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_workspace_event
from app.services.media.storage_usage import check_workspace_quota
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["members"])


@router.get("/relations", response_model=list[RelationOut])
def list_relations(
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace_public),
    db: Session = Depends(get_db),
):
    statement = (
        select(Relation)
        .where(Relation.workspace_id == tree.id)
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
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from_member = db.scalar(
        select(Member).where(
            Member.id == payload.from_member_id, Member.workspace_id == tree.id
        )
    )
    if from_member is None:
        raise HTTPException(
            status_code=404, detail="from_member_id not found in this tree"
        )
    to_member = db.scalar(
        select(Member).where(
            Member.id == payload.to_member_id, Member.workspace_id == tree.id
        )
    )
    if to_member is None:
        raise HTTPException(status_code=404, detail="to_member_id not found in this tree")
    if db.get(RelationType, payload.relation_type) is None:
        raise HTTPException(status_code=404, detail="Unknown relation_type")

    key = (tree.id, payload.from_member_id, payload.to_member_id, payload.relation_type)
    relation = db.get(Relation, key)
    if relation is None:
        check_workspace_quota(db, tree, len(str(payload.model_dump()).encode()))
        relation = Relation(workspace_id=tree.id, **payload.model_dump())
        db.add(relation)
        label = (
            f"{payload.from_member_id} → {payload.to_member_id} ({payload.relation_type})"
        )
        with UnitOfWork(db) as uow:
            record_activity(
                db,
                workspace_id=tree.id,
                actor=user,
                action="create",
                target_type="relation",
                target_label=label,
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    tree,
                    "workspace.content_changed",
                    {"workspace_id": tree.id, "domain": "member"},
                )
            )
            uow.after_commit(lambda: invalidate_stats(tree.id))
    return relation


@router.delete("/relations", status_code=204)
def remove_relation(
    from_member_id: str,
    to_member_id: str,
    relation_type: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    relation = db.get(Relation, (tree.id, from_member_id, to_member_id, relation_type))
    if relation is not None:
        label = f"{from_member_id} → {to_member_id} ({relation_type})"
        with UnitOfWork(db) as uow:
            record_activity(
                db,
                workspace_id=tree.id,
                actor=user,
                action="delete",
                target_type="relation",
                target_label=label,
                details=relation_delete_snapshot(relation),
            )
            db.delete(relation)
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    tree,
                    "workspace.content_changed",
                    {"workspace_id": tree.id, "domain": "member"},
                )
            )
            uow.after_commit(lambda: invalidate_stats(tree.id))
