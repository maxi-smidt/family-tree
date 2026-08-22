"""Stories and their links to members and documents."""

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
from app.models import Story, StoryDocumentLink, StoryMemberLink, Tree
from app.models.user import User
from app.schemas.content import (
    DocumentIdsSet,
    LinksSet,
    StoryCreate,
    StoryLinkOut,
    StoryOut,
    StoryUpdate,
)
from app.services.activity.activity import record_activity, story_delete_snapshot
from app.services.documents.content_links import (
    replace_document_links,
    replace_member_links,
)
from app.services.event_bus import publish_tree_event
from app.services.media.storage_usage import check_tree_quota
from app.services.unit_of_work import UnitOfWork

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


def _document_ids(db: Session, story_id: str) -> list[str]:
    return list(
        db.scalars(
            select(StoryDocumentLink.document_id).where(
                StoryDocumentLink.story_id == story_id
            )
        ).all()
    )


def _story_out(db: Session, story: Story) -> StoryOut:
    return StoryOut.model_validate(story).model_copy(
        update={"document_ids": _document_ids(db, story.id)}
    )


def _stories_out(db: Session, stories: list[Story]) -> list[StoryOut]:
    if not stories:
        return []
    story_ids = [s.id for s in stories]
    rows = db.execute(
        select(StoryDocumentLink.story_id, StoryDocumentLink.document_id).where(
            StoryDocumentLink.story_id.in_(story_ids)
        )
    ).all()
    doc_map: dict[str, list[str]] = {}
    for sid, did in rows:
        doc_map.setdefault(sid, []).append(did)
    return [
        StoryOut.model_validate(s).model_copy(
            update={"document_ids": doc_map.get(s.id, [])}
        )
        for s in stories
    ]


@router.get("", response_model=list[StoryOut])
def list_stories(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(Story).where(Story.tree_id == tree.id).order_by(Story.created_at, Story.id)
    )
    stories = db.scalars(apply_pagination(statement, pagination)).all()
    return _stories_out(db, list(stories))


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
    check_tree_quota(db, tree, len(str(data).encode()))
    with UnitOfWork(db) as uow:
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
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed", {"tree_id": tree.id, "domain": "story"}
            )
        )
    db.refresh(story)
    return _story_out(db, story)


@router.patch("/{story_id}", response_model=StoryOut)
def update_story(
    story_id: str,
    payload: StoryUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    with UnitOfWork(db) as uow:
        for key, value in payload.model_dump().items():
            setattr(story, key, value)
        record_activity(db, tree_id=tree.id, actor=user, action="update",
                        target_type="story", target_id=story.id, target_label=story.title)
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed", {"tree_id": tree.id, "domain": "story"}
            )
        )
    db.refresh(story)
    return _story_out(db, story)


@router.delete("/{story_id}", status_code=204)
def delete_story(
    story_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    story = _get_story(db, tree, story_id)
    with UnitOfWork(db) as uow:
        record_activity(db, tree_id=tree.id, actor=user, action="delete",
                        target_type="story", target_id=story.id, target_label=story.title,
                        details=story_delete_snapshot(db, story))
        db.delete(story)
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed", {"tree_id": tree.id, "domain": "story"}
            )
        )


@router.put("/{story_id}/links", status_code=204)
def set_links(
    story_id: str,
    payload: LinksSet,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this story."""
    story = _get_story(db, tree, story_id)
    with UnitOfWork(db) as uow:
        replace_member_links(
            db,
            link_model=StoryMemberLink,
            parent_fk=StoryMemberLink.story_id,
            parent_id=story_id,
            tree=tree,
            member_ids=payload.member_ids,
        )
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="story", target_id=story.id, target_label=story.title,
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed", {"tree_id": tree.id, "domain": "story"}
            )
        )


@router.put("/{story_id}/documents", status_code=204)
def set_documents(
    story_id: str,
    payload: DocumentIdsSet,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the full set of documents linked to this story."""
    story = _get_story(db, tree, story_id)
    with UnitOfWork(db) as uow:
        replace_document_links(
            db,
            link_model=StoryDocumentLink,
            parent_fk=StoryDocumentLink.story_id,
            parent_id=story_id,
            tree=tree,
            document_ids=payload.document_ids,
        )
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="story", target_id=story.id, target_label=story.title,
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed", {"tree_id": tree.id, "domain": "story"}
            )
        )
