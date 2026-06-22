"""Events and their links to members."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_writable_tree,
    require_domain,
    require_feature,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.session import get_db
from app.models import Event, EventMemberLink, Tree
from app.models.user import User
from app.schemas.content import EventCreate, EventLinkOut, EventOut, EventUpdate, LinksSet
from app.services.activity import record_activity
from app.services.content_links import replace_member_links
from app.services.event_bus import publish_tree_event
from app.services.storage_usage import QuotaExceeded, check_tree_quota

router = APIRouter(
    prefix="/trees/{tree_id}/events",
    tags=["events"],
    dependencies=[
        Depends(require_feature("events")),
        Depends(require_domain("events")),
    ],
)


def _get_event(db: Session, tree: Tree, event_id: str) -> Event:
    event = db.get(Event, event_id)
    if event is None or event.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.get("", response_model=list[EventOut])
def list_events(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(Event).where(Event.tree_id == tree.id).order_by(Event.created_at, Event.id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.get("/links", response_model=list[EventLinkOut])
def list_links(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(EventMemberLink)
        .join(Event, Event.id == EventMemberLink.event_id)
        .where(Event.tree_id == tree.id)
        .order_by(EventMemberLink.event_id, EventMemberLink.member_id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("", response_model=EventOut, status_code=201)
def create_event(
    payload: EventCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    try:
        check_tree_quota(db, tree, len(str(data).encode()))
    except QuotaExceeded as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    event = Event(tree_id=tree.id, **data)
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
        db, tree_id=tree.id, actor=user, action="create",
        target_type="event", target_id=event.id, target_label=event.event_type,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(event)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "event"},
    )
    return event


@router.patch("/{event_id}", response_model=EventOut)
def update_event(
    event_id: str,
    payload: EventUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = _get_event(db, tree, event_id)
    for key, value in payload.model_dump().items():
        setattr(event, key, value)
    record_activity(
        db, tree_id=tree.id, actor=user, action="update",
        target_type="event", target_id=event.id, target_label=event.event_type,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(event)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "event"},
    )
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(
    event_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = _get_event(db, tree, event_id)
    record_activity(
        db, tree_id=tree.id, actor=user, action="delete",
        target_type="event", target_id=event.id, target_label=event.event_type,
    )
    db.delete(event)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "event"},
    )


@router.put("/{event_id}/links", status_code=204)
def set_links(
    event_id: str,
    payload: LinksSet,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this event."""
    _get_event(db, tree, event_id)
    replace_member_links(
        db,
        link_model=EventMemberLink,
        parent_fk=EventMemberLink.event_id,
        parent_id=event_id,
        tree=tree,
        member_ids=payload.member_ids,
    )
    db.commit()
