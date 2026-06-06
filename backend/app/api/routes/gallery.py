"""Gallery images and their links to members."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, get_writable_tree
from app.db.session import get_db
from app.models import GalleryImage, GalleryMemberLink, Member, Tree
from app.schemas.content import (
    GalleryImageCreate,
    GalleryImageOut,
    GalleryImageUpdate,
    GalleryLinkOut,
    LinksSet,
)
from app.services.storage import process_image_field

router = APIRouter(prefix="/trees/{tree_id}/gallery", tags=["gallery"])


def _get_image(db: Session, tree: Tree, image_id: str) -> GalleryImage:
    image = db.get(GalleryImage, image_id)
    if image is None or image.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Image not found")
    return image


def _set_links(db: Session, tree: Tree, image_id: str, member_ids: list[str]) -> None:
    """Replace the image's member links, keeping only members of this tree."""
    db.query(GalleryMemberLink).filter(
        GalleryMemberLink.gallery_image_id == image_id
    ).delete()
    if not member_ids:
        return
    valid = db.scalars(
        select(Member.id).where(
            Member.tree_id == tree.id, Member.id.in_(set(member_ids))
        )
    ).all()
    for member_id in valid:
        db.add(GalleryMemberLink(gallery_image_id=image_id, member_id=member_id))


@router.get("/images", response_model=list[GalleryImageOut])
def list_images(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(
        select(GalleryImage).where(GalleryImage.tree_id == tree.id)
    ).all()


@router.get("/links", response_model=list[GalleryLinkOut])
def list_links(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(
        select(GalleryMemberLink)
        .join(GalleryImage, GalleryImage.id == GalleryMemberLink.gallery_image_id)
        .where(GalleryImage.tree_id == tree.id)
    ).all()


@router.post("/images", response_model=GalleryImageOut, status_code=201)
def create_image(
    payload: GalleryImageCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    data["imageData"] = process_image_field(tree.id, data.get("imageData"))
    image = GalleryImage(tree_id=tree.id, **data)
    db.add(image)
    db.flush()  # image row must exist before its links reference it
    _set_links(db, tree, image.id, member_ids)
    db.commit()
    db.refresh(image)
    return image


@router.patch("/images/{image_id}", response_model=GalleryImageOut)
def update_image(
    image_id: str,
    payload: GalleryImageUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    image = _get_image(db, tree, image_id)
    changes = payload.model_dump(exclude_unset=True)
    if "imageData" in changes:
        changes["imageData"] = process_image_field(tree.id, changes["imageData"])
    for key, value in changes.items():
        setattr(image, key, value)
    db.commit()
    db.refresh(image)
    return image


@router.delete("/images/{image_id}", status_code=204)
def delete_image(
    image_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    image = _get_image(db, tree, image_id)
    db.delete(image)
    db.commit()


@router.put("/images/{image_id}/links", status_code=204)
def set_links(
    image_id: str,
    payload: LinksSet,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this image."""
    _get_image(db, tree, image_id)
    _set_links(db, tree, image_id, payload.member_ids)
    db.commit()
