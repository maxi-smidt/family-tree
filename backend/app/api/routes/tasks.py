"""Research tasks — open questions and to-dos, linked to any number of
members (a task with no linked members is a tree-level task)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_workspace_access_authenticated,
    get_workspace_access_write,
    get_writable_workspace,
    require_domain,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import ContentType, MemberTask, MemberTaskLink, Workspace
from app.models.user import User
from app.schemas.content import (
    LinksSet,
    MemberTaskCreate,
    MemberTaskOut,
    MemberTaskUpdate,
)
from app.services.activity.activity import record_activity
from app.services.documents.content_links import replace_member_links
from app.services.event_bus import publish_workspace_event
from app.services.media.storage_usage import check_workspace_quota
from app.services.provenance import origin_section
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(
    prefix="/workspaces/{workspace_id}/tasks",
    tags=["tasks"],
    dependencies=[Depends(require_domain("tasks"))],
)

_DOMAIN = "tasks"


def _get_task(
    db: Session, tree: Workspace, task_id: str, context: WorkspaceAccessContext
) -> MemberTask:
    """Load a task for a *write* — see events._get_event for why the #984
    visibility/write check lives here rather than a separate GET route."""
    task = db.get(MemberTask, task_id)
    if task is None or task.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Task not found")
    context.require_write_content(db, ContentType.TASK, task_id, domain=_DOMAIN)
    return task


def _member_ids(db: Session, task_id: str) -> list[str]:
    return list(
        db.scalars(
            select(MemberTaskLink.member_id).where(MemberTaskLink.task_id == task_id)
        ).all()
    )


def _task_out(db: Session, task: MemberTask) -> MemberTaskOut:
    return MemberTaskOut.model_validate(task).model_copy(
        update={"member_ids": _member_ids(db, task.id)}
    )


def _tasks_out(db: Session, tasks: list[MemberTask]) -> list[MemberTaskOut]:
    if not tasks:
        return []
    task_ids = [t.id for t in tasks]
    rows = db.execute(
        select(MemberTaskLink.task_id, MemberTaskLink.member_id).where(
            MemberTaskLink.task_id.in_(task_ids)
        )
    ).all()
    member_map: dict[str, list[str]] = {}
    for tid, mid in rows:
        member_map.setdefault(tid, []).append(mid)
    return [
        MemberTaskOut.model_validate(t).model_copy(
            update={"member_ids": member_map.get(t.id, [])}
        )
        for t in tasks
    ]


def _notify(db: Session, tree: Workspace) -> None:
    publish_workspace_event(db, tree, "activity.entry_added", {"workspace_id": tree.id})
    publish_workspace_event(
        db,
        tree,
        "workspace.content_changed",
        {"workspace_id": tree.id, "domain": "task"},
    )


@router.get("", response_model=list[MemberTaskOut])
def list_tasks(
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    filters = [MemberTask.workspace_id == tree.id]
    content_filter = context.content_filter(
        ContentType.TASK, MemberTask.id, domain=_DOMAIN
    )
    if content_filter is not None:
        filters.append(content_filter)
    statement = select(MemberTask).where(*filters).order_by(
        MemberTask.created_at, MemberTask.id
    )
    tasks = db.scalars(apply_pagination(statement, pagination)).all()
    return _tasks_out(db, list(tasks))


@router.post("", response_model=MemberTaskOut, status_code=201)
def create_task(
    payload: MemberTaskCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    context.require_write_scope(origin_section(db), domain=_DOMAIN)
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    check_workspace_quota(db, tree, len(str(data).encode()))
    task = MemberTask(workspace_id=tree.id, done=False, **data)
    with UnitOfWork(db) as uow:
        db.add(task)
        db.flush()  # task row must exist before its links reference it
        replace_member_links(
            db,
            link_model=MemberTaskLink,
            parent_fk=MemberTaskLink.task_id,
            parent_id=task.id,
            tree=tree,
            member_ids=member_ids,
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="create",
            target_type="task",
            target_id=task.id,
            target_label=task.title,
        )
        uow.after_commit(lambda: _notify(db, tree))
    db.refresh(task)
    return _task_out(db, task)


@router.patch("/{task_id}", response_model=MemberTaskOut)
def update_task(
    task_id: str,
    payload: MemberTaskUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    task = _get_task(db, tree, task_id, context)
    for key, value in payload.model_dump().items():
        setattr(task, key, value)
    # Keep done/done_at consistent regardless of what the client sends.
    if not task.done:
        task.done_at = None
    elif task.done_at is None:
        task.done_at = utcnow_iso()
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="task",
            target_id=task.id,
            target_label=task.title,
        )
        uow.after_commit(lambda: _notify(db, tree))
    db.refresh(task)
    return _task_out(db, task)


@router.put("/{task_id}/links", status_code=204)
def set_links(
    task_id: str,
    payload: LinksSet,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this task."""
    task = _get_task(db, tree, task_id, context)
    with UnitOfWork(db) as uow:
        replace_member_links(
            db,
            link_model=MemberTaskLink,
            parent_fk=MemberTaskLink.task_id,
            parent_id=task_id,
            tree=tree,
            member_ids=payload.member_ids,
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="task",
            target_id=task.id,
            target_label=task.title,
        )
        uow.after_commit(lambda: _notify(db, tree))


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    task = _get_task(db, tree, task_id, context)
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="delete",
            target_type="task",
            target_id=task.id,
            target_label=task.title,
        )
        db.delete(task)
        uow.after_commit(lambda: _notify(db, tree))
