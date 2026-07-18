"""Research tasks — per-member (or tree-level) open questions and to-dos."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_writable_tree,
    require_feature,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.session import get_db
from app.models import Member, MemberTask, Tree
from app.models.user import User
from app.schemas.content import MemberTaskCreate, MemberTaskOut, MemberTaskUpdate
from app.services.activity import record_activity
from app.services.event_bus import publish_tree_event
from app.services.storage_usage import QuotaExceeded, check_tree_quota

router = APIRouter(
    prefix="/trees/{tree_id}/tasks",
    tags=["tasks"],
    dependencies=[Depends(require_feature("research_tasks"))],
)


def _get_task(db: Session, tree: Tree, task_id: str) -> MemberTask:
    task = db.get(MemberTask, task_id)
    if task is None or task.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _check_member(db: Session, tree: Tree, member_id: str | None) -> None:
    if member_id is None:
        return
    member = db.get(Member, member_id)
    if member is None or member.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Member not found")


def _notify(db: Session, tree: Tree) -> None:
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "task"},
    )


@router.get("", response_model=list[MemberTaskOut])
def list_tasks(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(MemberTask)
        .where(MemberTask.tree_id == tree.id)
        .order_by(MemberTask.created_at, MemberTask.id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("", response_model=MemberTaskOut, status_code=201)
def create_task(
    payload: MemberTaskCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    _check_member(db, tree, data["member_id"])
    try:
        check_tree_quota(db, tree, len(str(data).encode()))
    except QuotaExceeded as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    task = MemberTask(tree_id=tree.id, done=False, **data)
    db.add(task)
    record_activity(db, tree_id=tree.id, actor=user, action="create",
                    target_type="task", target_id=task.id, target_label=task.title)
    db.commit()
    db.refresh(task)
    _notify(db, tree)
    return task


@router.patch("/{task_id}", response_model=MemberTaskOut)
def update_task(
    task_id: str,
    payload: MemberTaskUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task(db, tree, task_id)
    for key, value in payload.model_dump().items():
        setattr(task, key, value)
    if not task.done:
        task.done_at = None
    record_activity(db, tree_id=tree.id, actor=user, action="update",
                    target_type="task", target_id=task.id, target_label=task.title)
    db.commit()
    db.refresh(task)
    _notify(db, tree)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task(db, tree, task_id)
    record_activity(db, tree_id=tree.id, actor=user, action="delete",
                    target_type="task", target_id=task.id, target_label=task.title)
    db.delete(task)
    db.commit()
    _notify(db, tree)
