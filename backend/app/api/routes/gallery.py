"""Gallery images and their links to members."""

from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_writable_tree,
    require_domain,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.core.exceptions import QuotaExceeded
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import (
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
    Member,
    MemberTask,
    Tree,
)
from app.models.user import User
from app.schemas.content import (
    GalleryImageOut,
    GalleryImageUpdate,
    GalleryLinkOut,
    GalleryLinksSet,
    UnknownFaceCreate,
    UnknownFaceOut,
    UnknownFaceResolve,
    UnknownFaceUpdate,
)
from app.schemas.user import StoredUserPreferences
from app.services.activity.activity import gallery_delete_snapshot, record_activity
from app.services.documents.content_links import (
    replace_gallery_member_links,
    replace_member_links,
)
from app.services.event_bus import event_bus, publish_tree_event
from app.services.media.storage import (
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    store_image_upload,
    trash_media,
)
from app.services.media.storage_usage import (
    check_media_quota,
    check_tree_quota,
    media_warning,
)
from app.services.system.settings_service import effective_storage_mode, get_media_limits
from app.services.unit_of_work import UnitOfWork

router = APIRouter(
    prefix="/trees/{tree_id}/gallery",
    tags=["gallery"],
    dependencies=[Depends(require_domain("gallery"))],
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
    user_mode = StoredUserPreferences.model_validate(
        user.preferences or {}
    ).image_storage_mode
    mode = effective_storage_mode(
        limits.image_storage_mode,
        limits.image_storage_allowed_modes,
        user_mode,
    )
    try:
        new_image_url, exif_date_taken = await store_image_upload(
            tree.id, image, limits, mode=mode, extract_exif_date=True
        )
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
    except QuotaExceeded:
        delete_media(new_image_url)
        raise

    now = utcnow_iso()
    image_row = GalleryImage(
        id=id,
        tree_id=tree.id,
        image_data=new_image_url,
        title=title,
        description=description,
        created_at=created_at or exif_date_taken,
        uploaded_at=uploaded_at or now,
    )
    try:
        with UnitOfWork(db):
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
    except Exception:
        # The bytes are already on disk; if persistence (through the commit
        # above) fails, remove them so a failed create cannot leave an orphan
        # file behind. This must not run for a failure below — the row is
        # already durable by then, so "compensating" would instead orphan a
        # live row by deleting the file it points at.
        delete_media(new_image_url)
        raise
    db.refresh(image_row)
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
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
    with UnitOfWork(db) as uow:
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="gallery_image", target_id=image.id, target_label=image.title,
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed",
                {"tree_id": tree.id, "domain": "gallery"},
            )
        )
    db.refresh(image)
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
    with UnitOfWork(db) as uow:
        record_activity(
            db, tree_id=tree.id, actor=user, action="delete",
            target_type="gallery_image", target_id=image.id, target_label=image.title,
            details=gallery_delete_snapshot(db, image),
        )
        db.delete(image)
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed",
                {"tree_id": tree.id, "domain": "gallery"},
            )
        )
        uow.after_commit(lambda: trash_media(image_url))


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
    with UnitOfWork(db):
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


# ---------------------------------------------------------------------------
# Unknown-face tags (issue #736)
#
# Marking a face region as "unknown person" creates exactly one open,
# tree-level research task (no member links) and records its id on the face
# row so the tag and the task stay in sync:
#   - resolving the face to a member turns it into a normal member link and
#     marks the task done;
#   - deleting the face deletes its still-open task too (a done task is kept
#     as history);
#   - completing or deleting the task from the tasks UI does NOT touch the
#     tag: ``task_id`` has ``ondelete="SET NULL"``, so a task delete just
#     detaches it, and a task completion leaves the face row untouched.
# GET is intentionally not gated on the research_tasks feature so existing
# tags stay visible even if the flag is later killed; only creating a new one
# requires the flag (it is the step that writes a task).
# ---------------------------------------------------------------------------


def _open_linked_task(
    db: Session, tree: Tree, face: GalleryUnknownFace
) -> MemberTask | None:
    """The face's research task, only while it is still open in this tree.

    Defensive: the task may have moved to another tree (extract/move) or
    already be gone or done — in all those cases the face's task link is
    treated as absent.
    """
    if not face.task_id:
        return None
    task = db.get(MemberTask, face.task_id)
    if task is None or task.tree_id != tree.id or task.done:
        return None
    return task


def _get_unknown_face(db: Session, tree: Tree, face_id: str) -> GalleryUnknownFace:
    face = db.get(GalleryUnknownFace, face_id)
    if face is None:
        raise HTTPException(status_code=404, detail="Face not found")
    image = db.get(GalleryImage, face.gallery_image_id)
    if image is None or image.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Face not found")
    return face


@router.get("/unknown-faces", response_model=list[UnknownFaceOut])
def list_unknown_faces(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(GalleryUnknownFace)
        .join(GalleryImage, GalleryImage.id == GalleryUnknownFace.gallery_image_id)
        .where(GalleryImage.tree_id == tree.id)
        .order_by(GalleryUnknownFace.gallery_image_id, GalleryUnknownFace.id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post(
    "/images/{image_id}/unknown-faces",
    response_model=UnknownFaceOut,
    status_code=201,
    dependencies=[Depends(require_domain("tasks"))],
)
def create_unknown_face(
    image_id: str,
    payload: UnknownFaceCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tag a face region as an unknown person, creating its research task."""
    image = _get_image(db, tree, image_id)

    title = payload.task_title or (
        f'Identify unknown person in "{image.title or image_id}"'
    )
    notes = payload.task_notes or None
    check_tree_quota(db, tree, len(str({"title": title, "notes": notes}).encode()))

    task = MemberTask(
        id=str(uuid4()),
        tree_id=tree.id,
        title=title,
        notes=notes,
        done=False,
        created_at=payload.created_at,
    )
    db.add(task)
    db.flush()  # task row must exist before the face references it

    face = GalleryUnknownFace(
        id=payload.id,
        gallery_image_id=image_id,
        x=payload.x,
        y=payload.y,
        w=payload.w,
        h=payload.h,
        task_id=task.id,
        created_at=payload.created_at,
    )
    db.add(face)

    with UnitOfWork(db) as uow:
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="gallery_image", target_id=image.id, target_label=image.title,
        )
        record_activity(
            db, tree_id=tree.id, actor=user, action="create",
            target_type="task", target_id=task.id, target_label=task.title,
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed",
                {"tree_id": tree.id, "domain": "gallery"},
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed", {"tree_id": tree.id, "domain": "task"},
            )
        )
    db.refresh(face)
    return face


@router.patch("/unknown-faces/{face_id}", response_model=UnknownFaceOut)
def update_unknown_face(
    face_id: str,
    payload: UnknownFaceUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Redraw an unknown-face region. Never creates or touches a task."""
    face = _get_unknown_face(db, tree, face_id)
    image = db.get(GalleryImage, face.gallery_image_id)
    face.x = payload.x
    face.y = payload.y
    face.w = payload.w
    face.h = payload.h
    with UnitOfWork(db) as uow:
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="gallery_image", target_id=image.id, target_label=image.title,
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed",
                {"tree_id": tree.id, "domain": "gallery"},
            )
        )
    db.refresh(face)
    return face


@router.post(
    "/unknown-faces/{face_id}/resolve",
    status_code=204,
    dependencies=[Depends(require_domain("tasks"))],
)
def resolve_unknown_face(
    face_id: str,
    payload: UnknownFaceResolve,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Turn an unknown-face tag into a member link and close its task."""
    face = _get_unknown_face(db, tree, face_id)
    image = db.get(GalleryImage, face.gallery_image_id)
    member = db.get(Member, payload.member_id)
    if member is None or member.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Member not found")

    existing_link = db.get(GalleryMemberLink, (face.gallery_image_id, member.id))
    if existing_link is not None:
        existing_link.x = face.x
        existing_link.y = face.y
        existing_link.w = face.w
        existing_link.h = face.h
    else:
        db.add(
            GalleryMemberLink(
                gallery_image_id=face.gallery_image_id,
                member_id=member.id,
                x=face.x,
                y=face.y,
                w=face.w,
                h=face.h,
            )
        )

    task = _open_linked_task(db, tree, face)
    task_changed = task is not None
    if task is not None:
        task.done = True
        task.done_at = utcnow_iso()
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="task", target_id=task.id, target_label=task.title,
        )

    with UnitOfWork(db) as uow:
        db.delete(face)
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="gallery_image", target_id=image.id, target_label=image.title,
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed",
                {"tree_id": tree.id, "domain": "gallery"},
            )
        )
        if task_changed:
            uow.after_commit(
                lambda: publish_tree_event(
                    db, tree, "tree.content_changed",
                    {"tree_id": tree.id, "domain": "task"},
                )
            )


@router.delete(
    "/unknown-faces/{face_id}",
    status_code=204,
    dependencies=[Depends(require_domain("tasks"))],
)
def delete_unknown_face(
    face_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove an unknown-face tag, deleting its task only if still open."""
    face = _get_unknown_face(db, tree, face_id)
    image = db.get(GalleryImage, face.gallery_image_id)

    task = _open_linked_task(db, tree, face)
    task_changed = task is not None
    if task is not None:
        record_activity(
            db, tree_id=tree.id, actor=user, action="delete",
            target_type="task", target_id=task.id, target_label=task.title,
        )
        db.delete(task)

    with UnitOfWork(db) as uow:
        db.delete(face)
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="gallery_image", target_id=image.id, target_label=image.title,
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "tree.content_changed",
                {"tree_id": tree.id, "domain": "gallery"},
            )
        )
        if task_changed:
            uow.after_commit(
                lambda: publish_tree_event(
                    db, tree, "tree.content_changed",
                    {"tree_id": tree.id, "domain": "task"},
                )
            )
