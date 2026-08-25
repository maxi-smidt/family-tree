"""Member disease records — scoped to a tree."""

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
from app.db.session import get_db
from app.models import ContentType, MemberDisease, Workspace
from app.models.user import User
from app.schemas.family import DiseaseCreate, DiseaseOut, DiseaseUpdate
from app.services.activity.activity import disease_delete_snapshot, record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_workspace_event
from app.services.media.storage_usage import check_workspace_quota
from app.services.members.member_access import get_member
from app.services.provenance import origin_section
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["members"])

_DOMAIN = "diseases"


@router.get(
    "/diseases",
    response_model=list[DiseaseOut],
    dependencies=[Depends(require_domain("diseases"))],
)
def list_diseases(
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    filters = [MemberDisease.workspace_id == tree.id]
    content_filter = context.content_filter(
        ContentType.DISEASE, MemberDisease.id, domain=_DOMAIN
    )
    if content_filter is not None:
        filters.append(content_filter)
    statement = select(MemberDisease).where(*filters).order_by(MemberDisease.id)
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post(
    "/diseases",
    response_model=DiseaseOut,
    status_code=201,
    dependencies=[Depends(require_domain("diseases"))],
)
def add_disease(
    payload: DiseaseCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    get_member(db, tree, payload.member_id)
    context.require_read_member(db, payload.member_id)
    context.require_write_scope(origin_section(db), domain=_DOMAIN)
    check_workspace_quota(db, tree, len(str(payload.model_dump()).encode()))
    disease = MemberDisease(workspace_id=tree.id, **payload.model_dump())
    db.add(disease)
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="create",
            target_type="disease",
            target_label=payload.name,
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
    db.refresh(disease)
    return disease


@router.patch(
    "/diseases/{disease_id}",
    response_model=DiseaseOut,
    dependencies=[Depends(require_domain("diseases"))],
)
def update_disease(
    disease_id: str,
    payload: DiseaseUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    context.require_write_content(db, ContentType.DISEASE, disease_id, domain=_DOMAIN)
    for key, value in payload.model_dump().items():
        setattr(disease, key, value)
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="disease",
            target_id=disease_id,
            target_label=disease.name,
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
    db.refresh(disease)
    return disease


@router.delete(
    "/diseases/{disease_id}",
    status_code=204,
    dependencies=[Depends(require_domain("diseases"))],
)
def delete_disease(
    disease_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    context.require_write_content(db, ContentType.DISEASE, disease_id, domain=_DOMAIN)
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="delete",
            target_type="disease",
            target_id=disease_id,
            target_label=disease.name,
            details=disease_delete_snapshot(db, disease),
        )
        db.delete(disease)
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
