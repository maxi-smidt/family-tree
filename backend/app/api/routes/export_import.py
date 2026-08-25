"""Encrypted export and import of an entire tree, plus GEDCOM import/export.

Bundle version migration lives in
``app.services.interchange.bundles.bundle_migration``; the background-job
orchestration for each import format lives in
``app.services.interchange.bundles.tree_bundle_import`` (native) and
``app.services.interchange.gedcom.tree_gedcom_import`` (GEDCOM). This module
stays thin: request validation, kicking off the background job, and the
export-side row serialization (which has no import-side counterpart to
share it with).
"""

from pathlib import Path
from typing import cast

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_workspace
from app.core.config import settings
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
    Member,
    MemberDisease,
    MemberTask,
    MemberTaskLink,
    Relation,
    RelationType,
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    Section,
    SectionMember,
    SectionPosition,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    User,
    Workspace,
)
from app.schemas.job import JobStarted
from app.services import crypto_export
from app.services.interchange.bundles.bundle_migration import (
    BUNDLE_VERSION,
    validate_and_migrate,
)
from app.services.interchange.bundles.bundle_types import (
    BundleCitationRow,
    BundleDocumentFileRow,
    BundleDocumentRow,
    BundleGalleryImageRow,
    BundleMemberRow,
    BundleRelationRow,
    TreeBundle,
    TreeBundleV5,
)
from app.services.interchange.bundles.tree_bundle_import import do_import
from app.services.interchange.gedcom import gedcom
from app.services.interchange.gedcom.tree_gedcom_import import do_import_gedcom
from app.services.media.storage import media_url_to_data_url
from app.services.system.job_service import create_job, run_job

router = APIRouter(prefix="/workspaces", tags=["export"])


class WorkspaceExportRequest(BaseModel):
    password: str | None = Field(default=None, max_length=1024)


def _rows(db: Session, model, workspace_id: str) -> list[dict[str, object]]:
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(select(model).where(model.workspace_id == workspace_id)).all()
    cols = [c.key for c in sa_inspect(model).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


@router.post("/{workspace_id}/export")
def export_tree(
    payload: WorkspaceExportRequest,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    members: list[BundleMemberRow] = _rows(db, Member, tree.id)
    for m in members:
        m["image_data"] = media_url_to_data_url(m.get("image_data"))
        # Identity links (#1016): a bundle never discloses the legacy
        # cross-workspace bridge pointer — it may name a member on another
        # workspace the importer has no access to, and it becomes stale the
        # moment the member is re-imported under a new id anyway.
        m.pop("linked_workspace_id", None)
        m.pop("linked_member_id", None)
    gallery: list[BundleGalleryImageRow] = _rows(db, GalleryImage, tree.id)
    for g in gallery:
        g["image_data"] = media_url_to_data_url(g.get("image_data"))

    document_files: list[BundleDocumentFileRow] = _rows(db, DocumentFile, tree.id)
    for f in document_files:
        if f.get("kind") == "file":
            f["url"] = media_url_to_data_url(f.get("url"))

    bundle: TreeBundleV5 = {
        "version": BUNDLE_VERSION,
        "app_version": settings.APP_VERSION,
        "exported_at": utcnow_iso(),
        "tree": {"name": tree.name, "created_at": tree.created_at},
        "members": members,
        "relations": _rows(db, Relation, tree.id),
        # The registry is instance-wide; bundle it so an import on another
        # instance can register any types it does not know yet.
        "relation_types": [
            {"id": rt.id, "description": rt.description}
            for rt in db.scalars(select(RelationType))
        ],
        "diseases": _rows(db, MemberDisease, tree.id),
        "tasks": _rows(db, MemberTask, tree.id),
        "task_links": _link_rows(db, MemberTaskLink, MemberTask, tree.id),
        "gallery_images": gallery,
        "gallery_links": _link_rows(db, GalleryMemberLink, GalleryImage, tree.id),
        "unknown_faces": _unknown_face_rows(db, tree.id),
        "events": _rows(db, Event, tree.id),
        "event_links": _link_rows(db, EventMemberLink, Event, tree.id),
        "stories": _rows(db, Story, tree.id),
        "story_links": _link_rows(db, StoryMemberLink, Story, tree.id),
        "documents": _rows(db, Document, tree.id),
        "document_files": document_files,
        "document_member_links": _document_link_rows(db, DocumentMemberLink, tree.id),
        "event_document_links": _document_link_rows(db, EventDocumentLink, tree.id),
        "story_document_links": _document_link_rows(db, StoryDocumentLink, tree.id),
        "sections": _rows(db, Section, tree.id),
        "section_members": _link_rows(db, SectionMember, Section, tree.id),
        "section_positions": _link_rows(db, SectionPosition, Section, tree.id),
        # Saved views are private to their owner — the live API never shows
        # one user's saved views to another (see list_saved_views) — so a
        # bundle only ever carries the exporting user's own views, never a
        # co-owner's or fellow editor's; importing re-parents each to the
        # importing user (see do_import).
        "saved_views": _owned_saved_view_rows(db, tree.id, user.id),
        "saved_view_sections": _owned_saved_view_section_rows(db, tree.id, user.id),
        "saved_view_positions": _saved_view_position_rows(db, tree.id, user.id),
    }

    blob = crypto_export.encrypt_bundle(bundle, payload.password or None)
    filename = f"{tree.name or 'family-tree'}.treedb"
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def _link_rows(
    db: Session, link_model, parent_model, workspace_id: str
) -> list[dict[str, object]]:
    from sqlalchemy import inspect as sa_inspect

    parent_id_col = next(
        c for c in link_model.__table__.columns if c.name != "member_id"
    ).name
    items = db.scalars(
        select(link_model)
        .join(parent_model, parent_model.id == getattr(link_model, parent_id_col))
        .where(parent_model.workspace_id == workspace_id)
    ).all()
    cols = [c.key for c in sa_inspect(link_model).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


def _unknown_face_rows(db: Session, workspace_id: str) -> list[dict[str, object]]:
    """Gallery unknown-face rows for *workspace_id*, reached through GalleryImage
    since the table itself carries no ``workspace_id`` (mirrors ``_link_rows``)."""
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(
        select(GalleryUnknownFace)
        .join(GalleryImage, GalleryImage.id == GalleryUnknownFace.gallery_image_id)
        .where(GalleryImage.workspace_id == workspace_id)
    ).all()
    cols = [c.key for c in sa_inspect(GalleryUnknownFace).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


def _document_link_rows(
    db: Session, link_model, workspace_id: str
) -> list[dict[str, object]]:
    """Rows of a document_id-keyed link table (member/event/story) scoped to
    *workspace_id* via the Document side — every such link table has a
    ``document_id`` column and Document always carries ``workspace_id``."""
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(
        select(link_model)
        .join(Document, Document.id == link_model.document_id)
        .where(Document.workspace_id == workspace_id)
    ).all()
    cols = [c.key for c in sa_inspect(link_model).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


def _owned_saved_view_rows(
    db: Session, workspace_id: str, owner_id: str
) -> list[dict[str, object]]:
    """A user's own saved views in *workspace_id* — never a co-owner's or a
    fellow editor's, mirroring ``list_saved_views``'s owner scoping."""
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(
        select(SavedView).where(
            SavedView.workspace_id == workspace_id, SavedView.owner_id == owner_id
        )
    ).all()
    cols = [c.key for c in sa_inspect(SavedView).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


def _owned_saved_view_section_rows(
    db: Session, workspace_id: str, owner_id: str
) -> list[dict[str, object]]:
    """Section-membership rows for *owner_id*'s own saved views, reached
    through SavedView since the table itself carries no ``owner_id``."""
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(
        select(SavedViewSection)
        .join(SavedView, SavedView.id == SavedViewSection.saved_view_id)
        .where(SavedView.workspace_id == workspace_id, SavedView.owner_id == owner_id)
    ).all()
    cols = [c.key for c in sa_inspect(SavedViewSection).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


def _saved_view_position_rows(
    db: Session, workspace_id: str, owner_id: str
) -> list[dict[str, object]]:
    """Layout-overlay rows for *owner_id*'s own saved views in *workspace_id*,
    reached through SavedView since the table itself carries neither
    ``workspace_id`` nor ``owner_id``."""
    from sqlalchemy import inspect as sa_inspect

    items = db.scalars(
        select(SavedViewPosition)
        .join(SavedView, SavedView.id == SavedViewPosition.saved_view_id)
        .where(SavedView.workspace_id == workspace_id, SavedView.owner_id == owner_id)
    ).all()
    cols = [c.key for c in sa_inspect(SavedViewPosition).mapper.column_attrs]
    return [{c: getattr(i, c) for c in cols} for i in items]


# Identity links are deliberately never exported: a link's counterpart member
# may live on a workspace this bundle's importer cannot reach, and importing
# one verbatim would recreate a "verified" cross-workspace link without that
# workspace's consent. See the member bridge-field strip in export_tree above
# for the same rule applied to the legacy (pre-identity-link) bridge pointer.


@router.post("/import/inspect")
async def inspect_import(file: UploadFile, db: Session = Depends(get_db)):
    blob = await file.read()
    try:
        if crypto_export.is_password_protected(blob):
            return {
                "password_required": True,
                "name": None,
                "app_version": None,
                "exported_at": None,
                "bundle_version": None,
            }
        bundle = cast(
            TreeBundle, await run_in_threadpool(crypto_export.decrypt_bundle, blob, None)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    bundle = validate_and_migrate(bundle)
    return {
        "password_required": False,
        "name": bundle.get("tree", {}).get("name"),
        "app_version": bundle.get("app_version"),
        "exported_at": bundle.get("exported_at"),
        "bundle_version": bundle.get("version"),
    }


@router.post("/import", response_model=JobStarted, status_code=202)
async def import_tree(
    file: UploadFile,
    password: str | None = Form(default=None),
    name: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    blob = await file.read()
    # Validate synchronously so bad/future files get an immediate error response.
    try:
        bundle = cast(
            TreeBundle,
            await run_in_threadpool(crypto_export.decrypt_bundle, blob, password or None),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail="Password required") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not read export file") from exc
    bundle = validate_and_migrate(bundle)

    job = create_job(db, user.id, "import")
    background_tasks.add_task(run_job, job.id, user.id, do_import, bundle, name, user.id)
    return JobStarted(job_id=job.id)


# ---------------------------------------------------------------------------
# GEDCOM export / import
# ---------------------------------------------------------------------------


@router.get(
    "/{workspace_id}/export-gedcom",
)
def export_tree_gedcom(
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
) -> Response:
    """Export the tree as a plain-text GEDCOM 5.5.1 file."""
    members_ged: list[BundleMemberRow] = _rows(db, Member, tree.id)
    relations_ged: list[BundleRelationRow] = _rows(db, Relation, tree.id)
    documents_ged: list[BundleDocumentRow] = _rows(db, Document, tree.id)
    document_files_ged: list[BundleDocumentFileRow] = [
        f for f in _rows(db, DocumentFile, tree.id) if f.get("kind") == "file"
    ]
    citations_ged: list[BundleCitationRow] = _document_link_rows(
        db, DocumentMemberLink, tree.id
    )
    text = gedcom.serialize_to_gedcom(
        tree.name or "family-tree",
        members_ged,
        relations_ged,
        documents=documents_ged,
        document_files=document_files_ged,
        citations=citations_ged,
        app_version=settings.APP_VERSION,
    )
    filename = f"{tree.name or 'family-tree'}.ged"
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/import-gedcom",
    response_model=JobStarted,
    status_code=202,
)
async def import_tree_gedcom(
    file: UploadFile,
    name: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> JobStarted:
    """Import a GEDCOM 5.5.1 file into a new tree owned by the current user."""
    raw = await file.read()
    text = await run_in_threadpool(gedcom.decode_gedcom_bytes, raw)

    try:
        parsed = await run_in_threadpool(gedcom.parse_gedcom, text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not read GEDCOM file") from exc

    filename_stem = Path(file.filename).stem.strip() if file.filename else ""
    workspace_name = name or filename_stem or parsed.get("_head_file") or "Imported tree"

    job = create_job(db, user.id, "import_gedcom")
    background_tasks.add_task(
        run_job, job.id, user.id, do_import_gedcom, parsed, workspace_name, user.id
    )
    return JobStarted(job_id=job.id)
