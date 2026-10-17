"""CRUD for saved views: config, layout overlay, and per-user state (#986).

Saved views replace virtual views as the workspace's canvas-arrangement
concept; see ``app.models.saved_view`` for why they need none of virtual
views' own content routes. ``virtual_views.py`` / ``virtual_view_content.py``
remain until #987 has converted and verified every source row.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_workspace_access_write,
    get_writable_workspace,
)
from app.core.exceptions import ConflictError
from app.db.session import get_db
from app.models import User, Workspace
from app.schemas.saved_view import (
    SavedViewCreate,
    SavedViewOut,
    SavedViewPositionItem,
    SavedViewUpdate,
    SavedViewUserStateOut,
    SavedViewUserStateUpdate,
)
from app.services.saved_views.saved_views import (
    SAVED_VIEW_STALE,
    create_saved_view,
    delete_saved_view,
    get_owned_saved_view,
    get_user_state,
    list_saved_views,
    mark_view_opened,
    saved_view_out,
    update_saved_view,
    update_user_state,
    upsert_saved_view_positions,
    view_last_opened,
)
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(
    prefix="/workspaces/{workspace_id}/saved-views", tags=["saved-views"]
)


@router.get("", response_model=list[SavedViewOut])
def get_saved_views(
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return [
        saved_view_out(db, tree, view, last_opened=view_last_opened(db, view.id, user.id))
        for view in list_saved_views(db, tree, user)
    ]


@router.post("", response_model=SavedViewOut, status_code=201)
def post_saved_view(
    payload: SavedViewCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    with UnitOfWork(db):
        view = create_saved_view(db, tree, user, context, payload)
    db.refresh(view)
    return saved_view_out(db, tree, view)


@router.get("/{view_id}", response_model=SavedViewOut)
def get_saved_view(
    view_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = get_owned_saved_view(db, tree, view_id, user)
    with UnitOfWork(db):
        mark_view_opened(db, view.id, user.id)
    last_opened = view_last_opened(db, view.id, user.id)
    return saved_view_out(db, tree, view, last_opened=last_opened)


@router.patch("/{view_id}", response_model=SavedViewOut)
def patch_saved_view(
    view_id: str,
    payload: SavedViewUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    view = get_owned_saved_view(db, tree, view_id, user)
    try:
        with UnitOfWork(db):
            update_saved_view(db, tree, view, context, payload)
            db.flush()
    except StaleDataError as exc:
        raise ConflictError(SAVED_VIEW_STALE) from exc
    db.refresh(view)
    last_opened = view_last_opened(db, view.id, user.id)
    return saved_view_out(db, tree, view, last_opened=last_opened)


@router.delete("/{view_id}", status_code=204)
def remove_saved_view(
    view_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = get_owned_saved_view(db, tree, view_id, user)
    with UnitOfWork(db):
        delete_saved_view(db, view)


@router.patch("/{view_id}/positions", status_code=204)
def patch_saved_view_positions(
    view_id: str,
    payload: list[SavedViewPositionItem],
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    view = get_owned_saved_view(db, tree, view_id, user)
    if not payload:
        return
    items = [(p.node_id, p.position_x, p.position_y) for p in payload]
    with UnitOfWork(db):
        upsert_saved_view_positions(db, view, items)


@router.get("/{view_id}/state", response_model=SavedViewUserStateOut)
def get_saved_view_state(
    view_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_saved_view(db, tree, view_id, user)
    state = get_user_state(db, view_id, user.id)
    if state is None:
        return SavedViewUserStateOut(
            last_opened=None,
            camera_x=None,
            camera_y=None,
            camera_zoom=None,
            collapsed_node_ids=None,
        )
    return state


@router.patch("/{view_id}/state", response_model=SavedViewUserStateOut)
def patch_saved_view_state(
    view_id: str,
    payload: SavedViewUserStateUpdate,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_saved_view(db, tree, view_id, user)
    with UnitOfWork(db):
        state = update_user_state(
            db,
            view_id,
            user.id,
            camera_x=payload.camera_x,
            camera_y=payload.camera_y,
            camera_zoom=payload.camera_zoom,
            collapsed_node_ids=payload.collapsed_node_ids,
        )
        db.flush()
        db.refresh(state)
    return state
