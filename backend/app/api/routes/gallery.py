"""Gallery images and their links to members."""

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
from app.models import GalleryImage, GalleryMemberLink, Tree
from app.models.user import User
from app.schemas.content import (
    GalleryImageCreate,
    GalleryImageOut,
    GalleryImageUpdate,
    GalleryLinkOut,
    LinksSet,
)
from app.services.activity import record_activity
from app.services.content_links import replace_member_links
from app.services.event_bus import publish_tree_event
from app.services.settings_service import effective_storage_mode, get_media_limits
from app.services.storage import (
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    process_gallery_image_field,
)
from app.services.storage_usage import QuotaExceeded, check_media_quota

router = APIRouter(
    prefix="/trees/{tree_id}/gallery",
    tags=["gallery"],
    dependencies=[
        Depends(require_feature("gallery")),
        Depends(require_domain("gallery")),
    ],
)


def _get_image(db: Session, tree: Tree, image_id: str) -> GalleryImage:
    image = db.get(GalleryImage, image_id)
    if image is None or image.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Image not found")
    return image

@router.get("/images", response_model=list[GalleryImageOut])
def list_images(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(GalleryImage)
        .where(GalleryImage.tree_id == tree.id)
        .order_by(GalleryImage.uploaded_at, GalleryImage.id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.get("/links", response_model=list[GalleryLinkOut])
def list_links(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(GalleryMemberLink)
        .join(GalleryImage, GalleryImage.id == GalleryMemberLink.gallery_image_id)
        .where(GalleryImage.tree_id == tree.id)
        .order_by(GalleryMemberLink.gallery_image_id, GalleryMemberLink.member_id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/images", response_model=GalleryImageOut, status_code=201)
def create_image(
    payload: GalleryImageCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    new_image_url: str | None = None
    try:
        limits = get_media_limits(db)
        user_mode = (user.preferences or {}).get("image_storage_mode")
        limits = limits.model_copy(
            update={
                "image_storage_mode": effective_storage_mode(
                    limits.image_storage_mode,
                    limits.image_storage_allowed_modes,
                    user_mode,
                )
            }
        )
        new_url = process_gallery_image_field(
            tree.id,
            data.get("image_data"),
            limits,
        )
        data["image_data"] = new_url
        if new_url and new_url.startswith(MEDIA_URL_PREFIX):
            new_image_url = new_url
    except ImageTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (UnsupportedImageType, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Write-then-verify: the file is already on disk and counted by
    # compute_usage, so pass 0 to avoid double-counting it.
    if new_image_url:
        try:
            check_media_quota(db, tree, 0)
        except QuotaExceeded as exc:
            delete_media(new_image_url)
            raise HTTPException(status_code=413, detail=str(exc)) from exc

    image = GalleryImage(tree_id=tree.id, **data)
    db.add(image)
    db.flush()  # image row must exist before its links reference it
    replace_member_links(
        db,
        link_model=GalleryMemberLink,
        parent_fk=GalleryMemberLink.gallery_image_id,
        parent_id=image.id,
        tree=tree,
        member_ids=member_ids,
    )
    record_activity(
        db, tree_id=tree.id, actor=user, action="create",
        target_type="gallery_image", target_id=image.id, target_label=image.title,
    )
    db.commit()
    db.refresh(image)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "gallery"},
    )
    return image


@router.patch("/images/{image_id}", response_model=GalleryImageOut)
def update_image(
    image_id: str,
    payload: GalleryImageUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    image = _get_image(db, tree, image_id)
    changes = payload.model_dump(exclude_unset=True)
    new_image_url: str | None = None
    if "image_data" in changes:
        try:
            limits = get_media_limits(db)
            user_mode = (user.preferences or {}).get("image_storage_mode")
            limits = limits.model_copy(
                update={
                    "image_storage_mode": effective_storage_mode(
                        limits.image_storage_mode, user_mode
                    )
                }
            )
            new_url = process_gallery_image_field(
                tree.id,
                changes["image_data"],
                limits,
            )
            changes["image_data"] = new_url
            if new_url and new_url.startswith(MEDIA_URL_PREFIX):
                new_image_url = new_url
        except ImageTooLarge as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except (UnsupportedImageType, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Write-then-verify: the file is already on disk and counted by
    # compute_usage, so pass 0 to avoid double-counting it.
    if new_image_url:
        try:
            check_media_quota(db, tree, 0)
        except QuotaExceeded as exc:
            delete_media(new_image_url)
            raise HTTPException(status_code=413, detail=str(exc)) from exc

    for key, value in changes.items():
        setattr(image, key, value)
    record_activity(
        db, tree_id=tree.id, actor=user, action="update",
        target_type="gallery_image", target_id=image.id, target_label=image.title,
    )
    db.commit()
    db.refresh(image)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "gallery"},
    )
    return image


@router.delete("/images/{image_id}", status_code=204)
def delete_image(
    image_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    image = _get_image(db, tree, image_id)
    image_url = image.image_data
    record_activity(
        db, tree_id=tree.id, actor=user, action="delete",
        target_type="gallery_image", target_id=image.id, target_label=image.title,
    )
    db.delete(image)
    db.commit()
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "gallery"},
    )
    delete_media(image_url)


@router.put("/images/{image_id}/links", status_code=204)
def set_links(
    image_id: str,
    payload: LinksSet,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Replace the full set of members linked to this image."""
    _get_image(db, tree, image_id)
    replace_member_links(
        db,
        link_model=GalleryMemberLink,
        parent_fk=GalleryMemberLink.gallery_image_id,
        parent_id=image_id,
        tree=tree,
        member_ids=payload.member_ids,
    )
    db.commit()
