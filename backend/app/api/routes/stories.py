"""Stories and their links to members."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, get_writable_tree
from app.db.session import get_db
from app.models import Story, StoryMemberLink, Tree
from app.schemas.content import LinkCreate, StoryCreate, StoryLinkOut, StoryOut, StoryUpdate

router = APIRouter(prefix="/trees/{tree_id}/stories", tags=["stories"])


def _get_story(db: Session, tree: Tree, story_id: str) -> Story:
    story = db.get(Story, story_id)
    if story is None or story.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Story not found")
    return story


@router.get("", response_model=list[StoryOut])
def list_stories(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(select(Story).where(Story.tree_id == tree.id)).all()


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
    story = Story(tree_id=tree.id, **payload.model_dump())
    db.add(story)
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
    db.delete(story)
    db.commit()


@router.post("/{story_id}/links", status_code=204)
def add_link(
    story_id: str,
    payload: LinkCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    _get_story(db, tree, story_id)
    if db.get(StoryMemberLink, (story_id, payload.member_id)) is None:
        db.add(StoryMemberLink(story_id=story_id, member_id=payload.member_id))
        db.commit()


@router.delete("/{story_id}/links", status_code=204)
def clear_links(
    story_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    _get_story(db, tree, story_id)
    db.query(StoryMemberLink).filter(StoryMemberLink.story_id == story_id).delete()
    db.commit()
