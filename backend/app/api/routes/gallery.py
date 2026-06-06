"""Gallery images and their links to members."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, get_writable_tree
from app.db.session import get_db
from app.models import GalleryImage, GalleryMemberLink, Tree
from app.schemas.content import (
    GalleryImageCreate,
    GalleryImageOut,
    GalleryImageUpdate,
    GalleryLinkOut,
    LinkCreate,
)
from app.services.storage import process_image_field

router = APIRouter(prefix="/trees/{tree_id}/gallery", tags=["gallery"])


def _get_image(db: Session, tree: Tree, image_id: str) -> GalleryImage:
    image = db.get(GalleryImage, image_id)
    if image is None or image.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Image not found")
    return image


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
    data["imageData"] = process_image_field(tree.id, data.get("imageData"))
    image = GalleryImage(tree_id=tree.id, **data)
    db.add(image)
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


@router.post("/images/{image_id}/links", status_code=204)
def add_link(
    image_id: str,
    payload: LinkCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    _get_image(db, tree, image_id)
    key = (image_id, payload.member_id)
    if db.get(GalleryMemberLink, key) is None:
        db.add(
            GalleryMemberLink(gallery_image_id=image_id, member_id=payload.member_id)
        )
        db.commit()


@router.delete("/images/{image_id}/links", status_code=204)
def clear_links(
    image_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    _get_image(db, tree, image_id)
    db.query(GalleryMemberLink).filter(
        GalleryMemberLink.gallery_image_id == image_id
    ).delete()
    db.commit()
