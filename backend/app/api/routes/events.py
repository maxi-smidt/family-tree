"""Events and their links to members."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, get_writable_tree
from app.db.session import get_db
from app.models import Event, EventMemberLink, Member, Tree
from app.schemas.content import EventCreate, EventLinkOut, EventOut, EventUpdate, LinksSet

router = APIRouter(prefix="/trees/{tree_id}/events", tags=["events"])


def _get_event(db: Session, tree: Tree, event_id: str) -> Event:
    event = db.get(Event, event_id)
    if event is None or event.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _set_links(db: Session, tree: Tree, event_id: str, member_ids: list[str]) -> None:
    """Replace the event's member links, keeping only members of this tree."""
    db.query(EventMemberLink).filter(EventMemberLink.event_id == event_id).delete()
    if not member_ids:
        return
    valid = db.scalars(
        select(Member.id).where(
            Member.tree_id == tree.id, Member.id.in_(set(member_ids))
        )
    ).all()
    for member_id in valid:
        db.add(EventMemberLink(event_id=event_id, member_id=member_id))


@router.get("", response_model=list[EventOut])
def list_events(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(select(Event).where(Event.tree_id == tree.id)).all()


@router.get("/links", response_model=list[EventLinkOut])
def list_links(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(
        select(EventMemberLink)
        .join(Event, Event.id == EventMemberLink.event_id)
        .where(Event.tree_id == tree.id)
    ).all()


@router.post("", response_model=EventOut, status_code=201)
def create_event(
    payload: EventCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    event = Event(tree_id=tree.id, **data)
    db.add(event)
    db.flush()  # event row must exist before its links reference it
    _set_links(db, tree, event.id, member_ids)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}", response_model=EventOut)
def update_event(
    event_id: str,
    payload: EventUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    event = _get_event(db, tree, event_id)
    for key, value in payload.model_dump().items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(
    event_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    event = _get_event(db, tree, event_id)
    db.delete(event)
    db.commit()


@router.put("/{event_id}/links", status_code=204)
def set_links(
    event_id: str,
    payload: LinksSet,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this event."""
    _get_event(db, tree, event_id)
    _set_links(db, tree, event_id, payload.member_ids)
    db.commit()
