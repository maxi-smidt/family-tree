"""Events and their links to members."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, get_writable_tree
from app.db.session import get_db
from app.models import Event, EventMemberLink, Tree
from app.schemas.content import EventCreate, EventLinkOut, EventOut, EventUpdate, LinkCreate

router = APIRouter(prefix="/trees/{tree_id}/events", tags=["events"])


def _get_event(db: Session, tree: Tree, event_id: str) -> Event:
    event = db.get(Event, event_id)
    if event is None or event.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


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
    event = Event(tree_id=tree.id, **payload.model_dump())
    db.add(event)
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


@router.post("/{event_id}/links", status_code=204)
def add_link(
    event_id: str,
    payload: LinkCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    _get_event(db, tree, event_id)
    if db.get(EventMemberLink, (event_id, payload.member_id)) is None:
        db.add(EventMemberLink(event_id=event_id, member_id=payload.member_id))
        db.commit()


@router.delete("/{event_id}/links", status_code=204)
def clear_links(
    event_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    _get_event(db, tree, event_id)
    db.query(EventMemberLink).filter(EventMemberLink.event_id == event_id).delete()
    db.commit()
