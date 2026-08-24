"""Reading and re-scoping content provenance (#1023).

Re-scoping is deliberately narrow: it is the only way a record's origin can
change, it is owner-authorized, it is logged, and it offers a preview of the
audience on both sides before anything moves. An editor — including a
section-scoped one once #993 lands — can therefore never widen the audience
of content they can already reach.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_writable_workspace,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.session import get_db
from app.models import ContentScope, ContentType, Section, Workspace
from app.models.user import User
from app.schemas.provenance import (
    ContentScopeOut,
    RescopeChange,
    RescopePreview,
    RescopeRequest,
)
from app.services.activity.activity import record_activity
from app.services.event_bus import publish_workspace_event
from app.services.provenance import rescope_content, scope_audience, scope_of
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/workspaces/{workspace_id}/content-scopes", tags=["sections"])


def _require_owner(tree: Workspace, user: User) -> None:
    if user.is_admin or tree.owner_id == user.id:
        return
    raise HTTPException(
        status_code=403, detail="Only the workspace owner can re-scope content"
    )


def _preview(db: Session, tree: Workspace, payload: RescopeRequest) -> RescopePreview:
    if payload.section_id is not None:
        section = db.get(Section, payload.section_id)
        if section is None or section.workspace_id != tree.id:
            raise HTTPException(status_code=404, detail="Section not found")

    after = scope_audience(db, tree, payload.section_id)
    changes: list[RescopeChange] = []
    for item in payload.items:
        scope = scope_of(db, item.content_type, item.content_id)
        if scope is None or scope.workspace_id != tree.id:
            raise HTTPException(status_code=404, detail="Content scope not found")
        changes.append(
            RescopeChange(
                content_type=scope.content_type,
                content_id=scope.content_id,
                from_section_id=scope.section_id,
                to_section_id=payload.section_id,
                audience_before=scope_audience(db, tree, scope.section_id),
                audience_after=after,
                # Only leaving a section widens the audience; entering or
                # switching one keeps it inside a section's collaborators.
                widens=scope.section_id is not None and payload.section_id is None,
            )
        )
    return RescopePreview(changes=changes)


@router.get("", response_model=list[ContentScopeOut])
def list_content_scopes(
    content_type: ContentType | None = None,
    section_id: str | None = None,
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
):
    statement = select(ContentScope).where(ContentScope.workspace_id == tree.id)
    if content_type is not None:
        statement = statement.where(ContentScope.content_type == str(content_type))
    if section_id is not None:
        statement = statement.where(ContentScope.section_id == section_id)
    statement = statement.order_by(ContentScope.content_type, ContentScope.content_id)
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/preview", response_model=RescopePreview)
def preview_rescope(
    payload: RescopeRequest,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_owner(tree, user)
    return _preview(db, tree, payload)


@router.post("", response_model=RescopePreview)
def apply_rescope(
    payload: RescopeRequest,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_owner(tree, user)
    # Computed first: after the move, the "before" side is gone.
    preview = _preview(db, tree, payload)
    with UnitOfWork(db) as uow:
        for item in payload.items:
            rescope_content(
                db,
                tree,
                content_type=item.content_type,
                content_id=item.content_id,
                section_id=payload.section_id,
            )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="content_scope",
            target_id=payload.section_id,
            details={"changes": [c.model_dump() for c in preview.changes]},
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
    return preview
