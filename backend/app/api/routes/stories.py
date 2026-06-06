"""Stories and their links to members, plus file attachments."""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_readable_tree, get_writable_tree
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Member, Story, StoryAttachment, StoryMemberLink, Tree
from app.schemas.content import (
    AttachmentCreate,
    AttachmentOut,
    AttachmentUpdate,
    LinksSet,
    StoryCreate,
    StoryLinkOut,
    StoryOut,
    StoryUpdate,
)
from app.services.storage import (
    FileTooLarge,
    UnsupportedFileType,
    delete_media,
    store_document,
)

router = APIRouter(prefix="/trees/{tree_id}/stories", tags=["stories"])


def _get_story(db: Session, tree: Tree, story_id: str) -> Story:
    story = db.get(Story, story_id)
    if story is None or story.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Story not found")
    return story


def _get_attachment(db: Session, story: Story, attachment_id: str) -> StoryAttachment:
    att = db.get(StoryAttachment, attachment_id)
    if att is None or att.story_id != story.id:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return att


def _set_links(db: Session, tree: Tree, story_id: str, member_ids: list[str]) -> None:
    """Replace the story's member links, keeping only members of this tree."""
    db.query(StoryMemberLink).filter(StoryMemberLink.story_id == story_id).delete()
    if not member_ids:
        return
    valid = db.scalars(
        select(Member.id).where(
            Member.tree_id == tree.id, Member.id.in_(set(member_ids))
        )
    ).all()
    for member_id in valid:
        db.add(StoryMemberLink(story_id=story_id, member_id=member_id))


@router.get("", response_model=list[StoryOut])
def list_stories(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(
        select(Story)
        .where(Story.tree_id == tree.id)
        .options(selectinload(Story.attachments))
    ).all()


@router.get("/links", response_model=list[StoryLinkOut])
def list_links(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(
        select(StoryMemberLink)
        .join(Story, Story.id == StoryMemberLink.story_id)
        .where(Story.tree_id == tree.id)
    ).all()


@router.post("", response_model=StoryOut, status_code=201)
def create_story(
    payload: StoryCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    story = Story(tree_id=tree.id, **data)
    db.add(story)
    db.flush()  # story row must exist before its links reference it
    _set_links(db, tree, story.id, member_ids)
    db.commit()
    db.refresh(story)
    return story


@router.patch("/{story_id}", response_model=StoryOut)
def update_story(
    story_id: str,
    payload: StoryUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    for key, value in payload.model_dump().items():
        setattr(story, key, value)
    db.commit()
    db.refresh(story)
    return story


@router.delete("/{story_id}", status_code=204)
def delete_story(
    story_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    # Remove the on-disk files before the rows cascade away.
    for att in story.attachments:
        delete_media(att.url)
    db.delete(story)
    db.commit()


@router.put("/{story_id}/links", status_code=204)
def set_links(
    story_id: str,
    payload: LinksSet,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this story."""
    _get_story(db, tree, story_id)
    _set_links(db, tree, story_id, payload.member_ids)
    db.commit()


# --- Attachments -----------------------------------------------------------
@router.post("/{story_id}/attachments", response_model=AttachmentOut, status_code=201)
def add_attachment(
    story_id: str,
    payload: AttachmentCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    try:
        url, mime, size = store_document(tree.id, payload.filename, payload.data)
    except FileTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except UnsupportedFileType as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    att = StoryAttachment(
        id=str(uuid4()),
        tree_id=tree.id,
        story_id=story.id,
        filename=payload.filename,
        url=url,
        mime_type=mime,
        size=size,
        created_at=utcnow_iso(),
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.patch(
    "/{story_id}/attachments/{attachment_id}", response_model=AttachmentOut
)
def rename_attachment(
    story_id: str,
    attachment_id: str,
    payload: AttachmentUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    att = _get_attachment(db, story, attachment_id)
    att.filename = payload.filename
    db.commit()
    db.refresh(att)
    return att


@router.delete("/{story_id}/attachments/{attachment_id}", status_code=204)
def delete_attachment(
    story_id: str,
    attachment_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    att = _get_attachment(db, story, attachment_id)
    delete_media(att.url)
    db.delete(att)
    db.commit()
