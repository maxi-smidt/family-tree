"""Events and their links to members and documents."""

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
from app.models import ContentType, Event, EventDocumentLink, EventMemberLink, Workspace
from app.models.user import User
from app.schemas.content import (
    DocumentIdsSet,
    EventCreate,
    EventLinkOut,
    EventOut,
    EventUpdate,
    LinksSet,
)
from app.services.activity.activity import event_delete_snapshot, record_activity
from app.services.documents.content_links import (
    replace_document_links,
    replace_member_links,
)
from app.services.event_bus import publish_workspace_event
from app.services.media.storage_usage import check_workspace_quota
from app.services.provenance import origin_section
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(
    prefix="/workspaces/{workspace_id}/events",
    tags=["events"],
    dependencies=[Depends(require_domain("events"))],
)

_DOMAIN = "events"


def _get_event(
    db: Session, tree: Workspace, event_id: str, context: WorkspaceAccessContext
) -> Event:
    """Load an event for a *write*: every caller here is a mutating route, so
    this is also the #984 choke point for "may this context change it"."""
    event = db.get(Event, event_id)
    if event is None or event.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Event not found")
    context.require_write_content(db, ContentType.EVENT, event_id, domain=_DOMAIN)
    return event


def _document_ids(db: Session, event_id: str) -> list[str]:
    return list(
        db.scalars(
            select(EventDocumentLink.document_id).where(
                EventDocumentLink.event_id == event_id
            )
        ).all()
    )


def _event_out(db: Session, event: Event) -> EventOut:
    return EventOut.model_validate(event).model_copy(
        update={"document_ids": _document_ids(db, event.id)}
    )


def _events_out(db: Session, events: list[Event]) -> list[EventOut]:
    if not events:
        return []
    event_ids = [e.id for e in events]
    rows = db.execute(
        select(EventDocumentLink.event_id, EventDocumentLink.document_id).where(
            EventDocumentLink.event_id.in_(event_ids)
        )
    ).all()
    doc_map: dict[str, list[str]] = {}
    for eid, did in rows:
        doc_map.setdefault(eid, []).append(did)
    return [
        EventOut.model_validate(e).model_copy(
            update={"document_ids": doc_map.get(e.id, [])}
        )
        for e in events
    ]


@router.get("", response_model=list[EventOut])
def list_events(
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    filters = [Event.workspace_id == tree.id]
    content_filter = context.content_filter(ContentType.EVENT, Event.id, domain=_DOMAIN)
    if content_filter is not None:
        filters.append(content_filter)
    statement = select(Event).where(*filters).order_by(Event.created_at, Event.id)
    events = db.scalars(apply_pagination(statement, pagination)).all()
    return _events_out(db, list(events))


@router.get("/links", response_model=list[EventLinkOut])
def list_links(
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    filters = [Event.workspace_id == tree.id]
    content_filter = context.content_filter(ContentType.EVENT, Event.id, domain=_DOMAIN)
    if content_filter is not None:
        filters.append(content_filter)
    statement = (
        select(EventMemberLink)
        .join(Event, Event.id == EventMemberLink.event_id)
        .where(*filters)
        .order_by(EventMemberLink.event_id, EventMemberLink.member_id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("", response_model=EventOut, status_code=201)
def create_event(
    payload: EventCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    context.require_write_scope(origin_section(db), domain=_DOMAIN)
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    check_workspace_quota(db, tree, len(str(data).encode()))
    with UnitOfWork(db) as uow:
        event = Event(workspace_id=tree.id, **data)
        db.add(event)
        db.flush()  # event row must exist before its links reference it
        replace_member_links(
            db,
            link_model=EventMemberLink,
            parent_fk=EventMemberLink.event_id,
            parent_id=event.id,
            tree=tree,
            member_ids=member_ids,
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="create",
            target_type="event",
            target_id=event.id,
            target_label=event.event_type,
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
                {"workspace_id": tree.id, "domain": "event"},
            )
        )
    db.refresh(event)
    return _event_out(db, event)


@router.patch("/{event_id}", response_model=EventOut)
def update_event(
    event_id: str,
    payload: EventUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    event = _get_event(db, tree, event_id, context)
    with UnitOfWork(db) as uow:
        for key, value in payload.model_dump().items():
            setattr(event, key, value)
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="event",
            target_id=event.id,
            target_label=event.event_type,
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
                {"workspace_id": tree.id, "domain": "event"},
            )
        )
    db.refresh(event)
    return _event_out(db, event)


@router.delete("/{event_id}", status_code=204)
def delete_event(
    event_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    event = _get_event(db, tree, event_id, context)
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="delete",
            target_type="event",
            target_id=event.id,
            target_label=event.event_type,
            details=event_delete_snapshot(db, event),
        )
        db.delete(event)
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
                {"workspace_id": tree.id, "domain": "event"},
            )
        )


@router.put("/{event_id}/links", status_code=204)
def set_links(
    event_id: str,
    payload: LinksSet,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this event."""
    event = _get_event(db, tree, event_id, context)
    with UnitOfWork(db) as uow:
        replace_member_links(
            db,
            link_model=EventMemberLink,
            parent_fk=EventMemberLink.event_id,
            parent_id=event_id,
            tree=tree,
            member_ids=payload.member_ids,
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="event",
            target_id=event.id,
            target_label=event.event_type,
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
                {"workspace_id": tree.id, "domain": "event"},
            )
        )


@router.put("/{event_id}/documents", status_code=204)
def set_documents(
    event_id: str,
    payload: DocumentIdsSet,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Replace the full set of documents linked to this event."""
    event = _get_event(db, tree, event_id, context)
    with UnitOfWork(db) as uow:
        replace_document_links(
            db,
            link_model=EventDocumentLink,
            parent_fk=EventDocumentLink.event_id,
            parent_id=event_id,
            tree=tree,
            document_ids=payload.document_ids,
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="event",
            target_id=event.id,
            target_label=event.event_type,
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
                {"workspace_id": tree.id, "domain": "event"},
            )
        )
