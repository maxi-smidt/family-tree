"""Gallery images and their links to members."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import GalleryImage, GalleryMemberLink, Tree
from app.models.user import User
from app.schemas.content import (
    GalleryImageOut,
    GalleryImageUpdate,
    GalleryLinkOut,
    GalleryLinksSet,
)
from app.services.activity import record_activity
from app.services.content_links import (
    replace_gallery_member_links,
    replace_member_links,
)
from app.services.event_bus import event_bus, publish_tree_event
from app.services.settings_service import effective_storage_mode, get_media_limits
from app.services.storage import (
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    store_image_upload,
)
from app.services.storage_usage import QuotaExceeded, check_media_quota, media_warning

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
async def create_image(
    id: str = Form(...),
    image: UploadFile = File(...),
    title: str | None = Form(default=None),
    description: str | None = Form(default=None),
    created_at: str | None = Form(default=None),
    uploaded_at: str | None = Form(default=None),
    member_ids: list[str] = Form(default=[]),
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream an uploaded gallery image to disk, then record its row.

    The image bytes travel as a multipart ``UploadFile`` (not a base64 JSON
    field), so ``store_image_upload`` streams them to a temp file with the MIME,
    size, dimension, decompression-bomb, and ``image_storage_mode`` safeguards
    intact before the row is written. The row and its member links commit as one
    unit; a rejection or a failed commit removes the stored bytes.
    """
    limits = get_media_limits(db)
    user_mode = (user.preferences or {}).get("image_storage_mode")
    mode = effective_storage_mode(
        limits.image_storage_mode,
        limits.image_storage_allowed_modes,
        user_mode,
    )
    try:
        new_image_url = await store_image_upload(tree.id, image, limits, mode=mode)
    except ImageTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (UnsupportedImageType, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await image.close()

    # Write-then-verify: the file is already on disk and counted by
    # compute_usage, so pass 0 to avoid double-counting it.
    try:
        check_media_quota(db, tree, 0)
    except QuotaExceeded as exc:
        delete_media(new_image_url)
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    now = utcnow_iso()
    image_row = GalleryImage(
        id=id,
        tree_id=tree.id,
        image_data=new_image_url,
        title=title,
        description=description,
        created_at=created_at or now,
        uploaded_at=uploaded_at or now,
    )
    try:
        db.add(image_row)
        db.flush()  # image row must exist before its links reference it
        replace_member_links(
            db,
            link_model=GalleryMemberLink,
            parent_fk=GalleryMemberLink.gallery_image_id,
            parent_id=image_row.id,
            tree=tree,
            member_ids=member_ids,
        )
        record_activity(
            db, tree_id=tree.id, actor=user, action="create",
            target_type="gallery_image", target_id=image_row.id,
            target_label=image_row.title,
        )
        db.commit()
    except Exception:
        # The bytes are already on disk; if any persistence step fails, remove
        # them so a failed create cannot leave an orphan file behind.
        db.rollback()
        delete_media(new_image_url)
        raise
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(image_row)
    warning = media_warning(db, tree)
    if warning:
        event_bus.publish([tree.owner_id], "storage.warning", warning)
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "gallery"},
    )
    return image_row


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
    # Image bytes are immutable after upload: they only ever come from the
    # streaming POST /images endpoint. The editor echoes back the existing
    # media URL, so drop any image_data here — a metadata edit must never
    # rewrite or re-store the image.
    changes.pop("image_data", None)
    for key, value in changes.items():
        setattr(image, key, value)
    record_activity(
        db, tree_id=tree.id, actor=user, action="update",
        target_type="gallery_image", target_id=image.id, target_label=image.title,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
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
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db, tree, "tree.content_changed",
        {"tree_id": tree.id, "domain": "gallery"},
    )
    delete_media(image_url)


@router.put("/images/{image_id}/links", status_code=204)
def set_links(
    image_id: str,
    payload: GalleryLinksSet,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the full set of members and optional face regions on an image."""
    image = _get_image(db, tree, image_id)
    replace_gallery_member_links(
        db,
        image_id=image_id,
        tree=tree,
        links=payload.links,
    )
    record_activity(
        db, tree_id=tree.id, actor=user, action="update",
        target_type="gallery_image", target_id=image.id, target_label=image.title,
    )
    db.commit()
