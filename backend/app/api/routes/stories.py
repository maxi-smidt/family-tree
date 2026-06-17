"""Stories and their links to members, plus file attachments."""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_writable_tree,
    require_domain,
    require_feature,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Story, StoryAttachment, StoryMemberLink, Tree
from app.models.user import User
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
from app.services.activity import record_activity
from app.services.content_links import replace_member_links
from app.services.settings_service import get_media_limits
from app.services.storage import (
    FileTooLarge,
    UnsupportedFileType,
    delete_media,
    store_document,
)
from app.services.storage_usage import QuotaExceeded, check_media_quota, check_tree_quota

router = APIRouter(
    prefix="/trees/{tree_id}/stories",
    tags=["stories"],
    dependencies=[
        Depends(require_feature("stories")),
        Depends(require_domain("stories")),
    ],
)


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

@router.get("", response_model=list[StoryOut])
def list_stories(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(Story)
        .where(Story.tree_id == tree.id)
        .order_by(Story.created_at, Story.id)
        .options(selectinload(Story.attachments))
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.get("/links", response_model=list[StoryLinkOut])
def list_links(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(StoryMemberLink)
        .join(Story, Story.id == StoryMemberLink.story_id)
        .where(Story.tree_id == tree.id)
        .order_by(StoryMemberLink.story_id, StoryMemberLink.member_id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("", response_model=StoryOut, status_code=201)
def create_story(
    payload: StoryCreate,
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
    story = Story(tree_id=tree.id, **data)
    db.add(story)
    db.flush()  # story row must exist before its links reference it
    replace_member_links(
        db,
        link_model=StoryMemberLink,
        parent_fk=StoryMemberLink.story_id,
        parent_id=story.id,
        tree=tree,
        member_ids=member_ids,
    )
    record_activity(db, tree_id=tree.id, actor=user, action="create",
                    target_type="story", target_id=story.id, target_label=story.title)
    db.commit()
    db.refresh(story)
    return story


@router.patch("/{story_id}", response_model=StoryOut)
def update_story(
    story_id: str,
    payload: StoryUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    for key, value in payload.model_dump().items():
        setattr(story, key, value)
    record_activity(db, tree_id=tree.id, actor=user, action="update",
                    target_type="story", target_id=story.id, target_label=story.title)
    db.commit()
    db.refresh(story)
    return story


@router.delete("/{story_id}", status_code=204)
def delete_story(
    story_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    record_activity(db, tree_id=tree.id, actor=user, action="delete",
                    target_type="story", target_id=story.id, target_label=story.title)
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
    replace_member_links(
        db,
        link_model=StoryMemberLink,
        parent_fk=StoryMemberLink.story_id,
        parent_id=story_id,
        tree=tree,
        member_ids=payload.member_ids,
    )
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
        url, mime, size = store_document(
            tree.id,
            payload.filename,
            payload.data,
            get_media_limits(db),
        )
    except FileTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except UnsupportedFileType as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        check_media_quota(db, tree, size)
    except QuotaExceeded as exc:
        delete_media(url)
        raise HTTPException(status_code=413, detail=str(exc)) from exc

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
