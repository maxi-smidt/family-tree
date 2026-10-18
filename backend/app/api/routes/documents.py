"""Documents: reusable files/links that can be attached to people, events and
stories.

Formerly the "Sources / Citations / Evidence" genealogy model; simplified into
a single reusable content type now called "Documents".
"""

from collections.abc import Iterable
from uuid import uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_workspace_access_authenticated,
    get_workspace_access_write,
    get_writable_workspace,
    require_domain,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.core.exceptions import QuotaExceeded
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import (
    ContentType,
    Document,
    DocumentFile,
    DocumentFileText,
    DocumentFileTranscription,
    DocumentMemberLink,
    DocumentUpload,
    EventDocumentLink,
    StoryDocumentLink,
    Workspace,
)
from app.models.user import User
from app.schemas.ai import DocumentFileTranscriptionOut
from app.schemas.content import (
    DocumentCreate,
    DocumentFileOut,
    DocumentFileTextOut,
    DocumentFileTextSave,
    DocumentFileUpdate,
    DocumentLinkCreate,
    DocumentOut,
    DocumentSave,
    DocumentUpdate,
    DocumentUploadOut,
    LinksSet,
)
from app.services.activity.activity import (
    document_delete_snapshot,
    document_file_delete_snapshot,
    record_activity,
)
from app.services.ai.transcription import (
    run_state,
    run_transcription,
    start_transcription,
    transcription_states,
)
from app.services.documents.content_links import replace_member_links
from app.services.documents.document_service import (
    DOMAIN,
    external_link_url,
    prune_stale_uploads,
    save_document,
)
from app.services.documents.file_text import files_with_text
from app.services.event_bus import publish_workspace_event
from app.services.media.storage import (
    ChecksumMismatch,
    FileTooLarge,
    UnsupportedFileType,
    delete_media,
    store_document_upload,
    trash_media,
)
from app.services.media.storage_usage import check_media_quota, check_workspace_quota
from app.services.provenance import origin_section
from app.services.system.settings_service import get_media_limits
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(
    prefix="/workspaces/{workspace_id}/documents",
    tags=["documents"],
    dependencies=[Depends(require_domain("sources"))],
)


def _get_document(
    db: Session, tree: Workspace, document_id: str, context: WorkspaceAccessContext
) -> Document:
    """Load a document for a *write* — see events._get_event for why the
    #984 visibility/write check lives here rather than a separate GET route."""
    document = db.get(Document, document_id)
    if document is None or document.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Document not found")
    context.require_write_content(db, ContentType.DOCUMENT, document_id, domain=DOMAIN)
    return document


def _get_readable_document(
    db: Session, tree: Workspace, document_id: str, context: WorkspaceAccessContext
) -> Document:
    """Load a document for a *read*, with the same visibility rule as the
    list: a document the caller can't see is a 404, not a 403."""
    statement = select(Document).where(
        Document.id == document_id, Document.workspace_id == tree.id
    )
    content_filter = context.content_filter(
        ContentType.DOCUMENT, Document.id, domain=DOMAIN
    )
    if content_filter is not None:
        statement = statement.where(content_filter)
    document = db.scalar(statement)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


def _get_file(db: Session, document: Document, file_id: str) -> DocumentFile:
    file = db.get(DocumentFile, file_id)
    if file is None or file.document_id != document.id:
        raise HTTPException(status_code=404, detail="File not found")
    return file


def _linked_ids(db: Session, link_model, id_column, document_id: str) -> list[str]:
    return list(
        db.scalars(select(id_column).where(link_model.document_id == document_id)).all()
    )


_FileStates = tuple[set[str], dict[str, DocumentFileTranscription]]


def _file_states(db: Session, file_ids: Iterable[str]) -> _FileStates:
    """Which files have a text, and each file's latest AI run, in two queries."""
    ids = list(file_ids)
    return files_with_text(db, ids), transcription_states(db, ids)


def _file_out(file: DocumentFile, states: _FileStates) -> DocumentFileOut:
    with_text, runs = states
    update: dict[str, object] = {"has_text": file.id in with_text}
    run = runs.get(file.id)
    if run is not None:
        update["transcription_status"], update["transcription_error"] = run_state(run)
    return DocumentFileOut.model_validate(file).model_copy(update=update)


def _document_out(db: Session, document: Document) -> DocumentOut:
    states = _file_states(db, (f.id for f in document.files))
    return DocumentOut.model_validate(document).model_copy(
        update={
            "files": [_file_out(f, states) for f in document.files],
            "member_ids": _linked_ids(
                db, DocumentMemberLink, DocumentMemberLink.member_id, document.id
            ),
            "event_ids": _linked_ids(
                db, EventDocumentLink, EventDocumentLink.event_id, document.id
            ),
            "story_ids": _linked_ids(
                db, StoryDocumentLink, StoryDocumentLink.story_id, document.id
            ),
        }
    )


def _documents_out(db: Session, documents: list[Document]) -> list[DocumentOut]:
    if not documents:
        return []
    doc_ids = [d.id for d in documents]
    member_rows = db.execute(
        select(DocumentMemberLink.document_id, DocumentMemberLink.member_id).where(
            DocumentMemberLink.document_id.in_(doc_ids)
        )
    ).all()
    event_rows = db.execute(
        select(EventDocumentLink.document_id, EventDocumentLink.event_id).where(
            EventDocumentLink.document_id.in_(doc_ids)
        )
    ).all()
    story_rows = db.execute(
        select(StoryDocumentLink.document_id, StoryDocumentLink.story_id).where(
            StoryDocumentLink.document_id.in_(doc_ids)
        )
    ).all()

    member_map: dict[str, list[str]] = {}
    for did, mid in member_rows:
        member_map.setdefault(did, []).append(mid)
    event_map: dict[str, list[str]] = {}
    for did, eid in event_rows:
        event_map.setdefault(did, []).append(eid)
    story_map: dict[str, list[str]] = {}
    for did, sid in story_rows:
        story_map.setdefault(did, []).append(sid)
    states = _file_states(db, (f.id for d in documents for f in d.files))

    return [
        DocumentOut.model_validate(d).model_copy(
            update={
                "files": [_file_out(f, states) for f in d.files],
                "member_ids": member_map.get(d.id, []),
                "event_ids": event_map.get(d.id, []),
                "story_ids": story_map.get(d.id, []),
            }
        )
        for d in documents
    ]


@router.get("", response_model=list[DocumentOut])
def list_documents(
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    filters = [Document.workspace_id == tree.id]
    content_filter = context.content_filter(
        ContentType.DOCUMENT, Document.id, domain=DOMAIN
    )
    if content_filter is not None:
        filters.append(content_filter)
    statement = (
        select(Document)
        .where(*filters)
        .order_by(Document.created_at, Document.id)
        .options(selectinload(Document.files))
    )
    documents = db.scalars(apply_pagination(statement, pagination)).all()
    return _documents_out(db, list(documents))


@router.post("", response_model=DocumentOut, status_code=201)
def create_document(
    payload: DocumentCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    context.require_write_scope(origin_section(db), domain=DOMAIN)
    data = payload.model_dump()
    member_ids = data.pop("member_ids")
    check_workspace_quota(db, tree, len(str(data).encode()))
    now = utcnow_iso()
    document = Document(
        id=str(uuid4()),
        workspace_id=tree.id,
        created_at=now,
        updated_at=now,
        **data,
    )
    with UnitOfWork(db) as uow:
        db.add(document)
        db.flush()  # document row must exist before its links reference it
        replace_member_links(
            db,
            link_model=DocumentMemberLink,
            parent_fk=DocumentMemberLink.document_id,
            parent_id=document.id,
            tree=tree,
            member_ids=member_ids,
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="create",
            target_type="document",
            target_id=document.id,
            target_label=document.title,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )
    db.refresh(document)
    return _document_out(db, document)


@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: str,
    payload: DocumentUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    document = _get_document(db, tree, document_id, context)
    for key, value in payload.model_dump().items():
        setattr(document, key, value)
    document.updated_at = utcnow_iso()
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="document",
            target_id=document.id,
            target_label=document.title,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )
    db.refresh(document)
    return _document_out(db, document)


@router.put("/{document_id}", response_model=DocumentOut)
def save_document_route(
    document_id: str,
    payload: DocumentSave,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Create or update a document and apply every file change atomically.

    A single request carries the metadata, people-mentioned links, staged file
    attachments, removals and renames. They validate and commit as one unit: a
    failure leaves the previously valid document — and its files — untouched,
    and replaying the same request is a no-op (see
    ``app.services.documents.document_service.save_document``).
    """
    document = save_document(
        db,
        tree=tree,
        user=user,
        context=context,
        document_id=document_id,
        payload=payload,
    )
    return _document_out(db, document)


@router.delete("/{document_id}", status_code=204)
def delete_document(
    document_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    document = _get_document(db, tree, document_id, context)
    # Capture the on-disk URLs before the row is gone, but only move the bytes
    # to trash *after* the DB commit succeeds. Removing them first would leave
    # a live row pointing at a missing file if the commit then failed.
    file_urls = [f.url for f in document.files if f.kind == "file"]

    def _trash_files() -> None:
        for url in file_urls:
            trash_media(url)

    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="delete",
            target_type="document",
            target_id=document.id,
            target_label=document.title,
            details=document_delete_snapshot(db, document),
        )
        db.delete(document)
        uow.after_commit(_trash_files)
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )


# --- People mentioned --------------------------------------------------------


@router.put("/{document_id}/members", status_code=204)
def set_document_members(
    document_id: str,
    payload: LinksSet,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Replace the full set of people mentioned by this document."""
    document = _get_document(db, tree, document_id, context)
    with UnitOfWork(db) as uow:
        replace_member_links(
            db,
            link_model=DocumentMemberLink,
            parent_fk=DocumentMemberLink.document_id,
            parent_id=document_id,
            tree=tree,
            member_ids=payload.member_ids,
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="document",
            target_id=document.id,
            target_label=document.title,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )


# --- Files -------------------------------------------------------------------


@router.post("/uploads", response_model=DocumentUploadOut, status_code=201)
async def stage_upload(
    file: UploadFile = File(...),
    filename: str = Form(...),
    checksum: str | None = Form(default=None),
    tree: Workspace = Depends(get_writable_workspace),
    db: Session = Depends(get_db),
):
    """Stream a file into the staging area, to be attached by a document save.

    The bytes are written to their final media location and recorded as a
    staged upload; a later ``PUT /documents/{id}`` attaches it transactionally.
    Uploads that are never attached are reaped after a TTL.
    """
    # Reclaim this tree's abandoned uploads opportunistically before adding one.
    prune_stale_uploads(db, tree)

    try:
        url, mime, size = await store_document_upload(
            tree.id,
            filename,
            file,
            get_media_limits(db),
            checksum=checksum,
        )
    except FileTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except UnsupportedFileType as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ChecksumMismatch as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await file.close()

    # Write-then-verify: the file is already on disk and counted by
    # compute_usage, so pass 0 to avoid double-counting it.
    try:
        check_media_quota(db, tree, 0)
    except QuotaExceeded:
        delete_media(url)
        raise

    upload = DocumentUpload(
        id=str(uuid4()),
        workspace_id=tree.id,
        filename=filename,
        url=url,
        mime_type=mime,
        size=size,
        created_at=utcnow_iso(),
    )
    try:
        with UnitOfWork(db):
            db.add(upload)
    except Exception:
        # The bytes are already on disk; if the staging row never commits,
        # remove them so a failed stage can't leave an orphan file behind.
        delete_media(url)
        raise
    db.refresh(upload)
    return upload


@router.post("/{document_id}/files", response_model=DocumentFileOut, status_code=201)
async def add_file(
    document_id: str,
    file: UploadFile = File(...),
    filename: str = Form(...),
    checksum: str | None = Form(default=None),
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    document = _get_document(db, tree, document_id, context)

    try:
        url, mime, size = await store_document_upload(
            tree.id,
            filename,
            file,
            get_media_limits(db),
            checksum=checksum,
        )
    except FileTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except UnsupportedFileType as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ChecksumMismatch as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await file.close()

    # Write-then-verify: the file is already on disk and counted by
    # compute_usage, so pass 0 to avoid double-counting it.
    try:
        check_media_quota(db, tree, 0)
    except QuotaExceeded:
        delete_media(url)
        raise

    file = DocumentFile(
        id=str(uuid4()),
        workspace_id=tree.id,
        document_id=document.id,
        kind="file",
        filename=filename,
        url=url,
        mime_type=mime,
        size=size,
        created_at=utcnow_iso(),
    )
    try:
        with UnitOfWork(db) as uow:
            db.add(file)
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    tree,
                    "workspace.content_changed",
                    {"workspace_id": tree.id, "domain": "document"},
                )
            )
    except Exception:
        # The bytes are already on disk; if the row never commits, remove them
        # so a failed upload can't leave an orphan file behind.
        delete_media(url)
        raise
    db.refresh(file)
    return file


@router.post("/{document_id}/links", response_model=DocumentFileOut, status_code=201)
def add_link(
    document_id: str,
    payload: DocumentLinkCreate,
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    document = _get_document(db, tree, document_id, context)

    link_url = external_link_url(payload.url)

    file = DocumentFile(
        id=str(uuid4()),
        workspace_id=tree.id,
        document_id=document.id,
        kind="link",
        filename=payload.filename,
        url=link_url,
        mime_type=None,
        size=None,
        created_at=utcnow_iso(),
    )
    with UnitOfWork(db) as uow:
        db.add(file)
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )
    db.refresh(file)
    return file


@router.patch("/{document_id}/files/{file_id}", response_model=DocumentFileOut)
def rename_file(
    document_id: str,
    file_id: str,
    payload: DocumentFileUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    document = _get_document(db, tree, document_id, context)
    file = _get_file(db, document, file_id)
    with UnitOfWork(db) as uow:
        file.filename = payload.filename
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )
    db.refresh(file)
    return _file_out(file, _file_states(db, [file.id]))


@router.delete("/{document_id}/files/{file_id}", status_code=204)
def delete_file(
    document_id: str,
    file_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    document = _get_document(db, tree, document_id, context)
    file = _get_file(db, document, file_id)
    # Move the bytes to trash only after the row is durably gone: deleting
    # first would leave a live row pointing at a missing file if the commit
    # then failed.
    url = file.url if file.kind == "file" else None
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="delete",
            target_type="document_file",
            target_id=file.id,
            target_label=file.filename,
            details=document_file_delete_snapshot(
                file, url, db.get(DocumentFileText, file.id)
            ),
        )
        db.delete(file)
        if url is not None:
            uow.after_commit(lambda: trash_media(url))
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )


# --- File text (#1121) -------------------------------------------------------


@router.get(
    "/{document_id}/files/{file_id}/text",
    response_model=DocumentFileTextOut | None,
)
def get_file_text(
    document_id: str,
    file_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    """The file's Markdown text, or ``null`` when it has none yet."""
    document = _get_readable_document(db, tree, document_id, context)
    file = _get_file(db, document, file_id)
    return db.get(DocumentFileText, file.id)


@router.put(
    "/{document_id}/files/{file_id}/text",
    response_model=DocumentFileTextOut | None,
)
def save_file_text(
    document_id: str,
    file_id: str,
    payload: DocumentFileTextSave,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Replace the file's text with a person's version; an empty text removes it.

    ``machine_markdown`` is left alone, so a machine original (AI
    transcription, a later step) stays available next to the corrected text.
    """
    document = _get_document(db, tree, document_id, context)
    file = _get_file(db, document, file_id)
    if file.kind != "file":
        raise HTTPException(status_code=400, detail="Links have no text")
    markdown = payload.markdown if payload.markdown.strip() else ""
    existing = db.get(DocumentFileText, file.id)
    if not markdown and existing is None:
        return None
    previous = len(existing.markdown.encode()) if existing is not None else 0
    check_workspace_quota(db, tree, max(0, len(markdown.encode()) - previous))
    now = utcnow_iso()
    with UnitOfWork(db) as uow:
        if not markdown:
            db.delete(existing)
            text = None
        elif existing is None:
            text = DocumentFileText(
                document_file_id=file.id,
                workspace_id=tree.id,
                language=payload.language,
                markdown=markdown,
                source="manual",
                edited_by=user.id,
                edited_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(text)
        else:
            text = existing
            text.markdown = markdown
            text.language = payload.language
            text.edited_by = user.id
            text.edited_at = now
            text.updated_at = now
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="document",
            target_id=document.id,
            target_label=document.title,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "document"},
            )
        )
    if text is not None:
        db.refresh(text)
    return text


# --- AI transcription (#1123) -----------------------------------------------


@router.post(
    "/{document_id}/files/{file_id}/transcribe",
    response_model=DocumentFileTranscriptionOut,
    status_code=202,
)
def transcribe_file(
    document_id: str,
    file_id: str,
    background_tasks: BackgroundTasks,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Send the file to the caller's own AI provider and fill its text.

    Runs in the background; the caller gets a
    ``document.transcription_finished`` event when it is done. Only ever
    started by this explicit request, never on upload.
    """
    document = _get_document(db, tree, document_id, context)
    file = _get_file(db, document, file_id)
    run = start_transcription(db, tree, file, user)
    background_tasks.add_task(run_transcription, file.id)
    return run
