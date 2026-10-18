"""Evidence for person fields: documents cited for a member's names, birth and
death dates and birthplace.

Citations belong to the Documents area: a caller who can't read the cited
document (Documents hidden, or the document is outside their sections) never
sees the citation, not even as a count. Adding, changing or removing one
needs Edit on the document and on the person.
"""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_workspace_access_authenticated,
    get_workspace_access_write,
    get_writable_workspace,
    require_domain,
)
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import (
    ContentType,
    Document,
    DocumentFile,
    DocumentMemberLink,
    Member,
    MemberFieldCitation,
    Workspace,
)
from app.models.user import User
from app.schemas.citations import (
    MemberFieldCitationCreate,
    MemberFieldCitationOut,
    MemberFieldCitationUpdate,
)
from app.services.activity.activity import record_activity
from app.services.documents.citations import quote_states
from app.services.documents.document_service import DOMAIN
from app.services.event_bus import publish_workspace_event
from app.services.media.storage_usage import check_workspace_quota
from app.services.members.member_access import get_member
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(
    prefix="/workspaces/{workspace_id}/citations",
    tags=["citations"],
    dependencies=[Depends(require_domain("sources"))],
)


def _outs(
    db: Session, citations: list[MemberFieldCitation]
) -> list[MemberFieldCitationOut]:
    states = quote_states(db, citations)
    return [
        MemberFieldCitationOut.model_validate(c).model_copy(
            update={"quote_found": states.get(c.id)}
        )
        for c in citations
    ]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _apply_anchor(
    db: Session,
    citation: MemberFieldCitation,
    payload: MemberFieldCitationCreate | MemberFieldCitationUpdate,
) -> None:
    """Set where in its document the citation points; a quote needs a file."""
    if payload.document_file_id is not None:
        file = db.get(DocumentFile, payload.document_file_id)
        if file is None or file.document_id != citation.document_id:
            raise HTTPException(status_code=404, detail="File not found")
    quote = _clean(payload.quote)
    if quote is not None and payload.document_file_id is None:
        raise HTTPException(status_code=422, detail="A quote needs a file")
    citation.document_file_id = payload.document_file_id
    citation.page = payload.page
    citation.quote = quote
    # Context around the quote is only meaningful with the quote itself.
    citation.quote_prefix = payload.quote_prefix if quote is not None else None
    citation.quote_suffix = payload.quote_suffix if quote is not None else None
    citation.note = _clean(payload.note)


def _require_write(
    db: Session,
    context: WorkspaceAccessContext,
    member_id: str,
    document_id: str,
) -> None:
    context.require_write_content(db, ContentType.DOCUMENT, document_id, domain=DOMAIN)
    context.require_write_member(db, member_id)


def _get_citation(
    db: Session, tree: Workspace, citation_id: str
) -> MemberFieldCitation:
    citation = db.get(MemberFieldCitation, citation_id)
    if citation is None or citation.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Citation not found")
    return citation


def _record(
    db: Session,
    uow: UnitOfWork,
    tree: Workspace,
    user: User,
    member_id: str,
) -> None:
    """Log the change as an update of the person and tell open clients."""
    member = db.get(Member, member_id)
    label = (
        " ".join(filter(None, [member.first_name, member.last_name])) or None
        if member is not None
        else None
    )
    record_activity(
        db,
        workspace_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=member_id,
        target_label=label,
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
            {"workspace_id": tree.id, "domain": "citation"},
        )
    )


@router.get("", response_model=list[MemberFieldCitationOut])
def list_citations(
    member_id: str | None = Query(None),
    document_id: str | None = Query(None),
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    """Every citation the caller may see: its document and its person are
    both readable to them."""
    filters = [MemberFieldCitation.workspace_id == tree.id]
    if member_id is not None:
        filters.append(MemberFieldCitation.member_id == member_id)
    if document_id is not None:
        filters.append(MemberFieldCitation.document_id == document_id)
    document_filter = context.content_filter(
        ContentType.DOCUMENT, MemberFieldCitation.document_id, domain=DOMAIN
    )
    if document_filter is not None:
        filters.append(document_filter)
    member_filter = context.member_filter()
    if member_filter is not None:
        filters.append(
            MemberFieldCitation.member_id.in_(select(Member.id).where(member_filter))
        )
    statement = (
        select(MemberFieldCitation)
        .where(*filters)
        .order_by(MemberFieldCitation.created_at, MemberFieldCitation.id)
    )
    return _outs(db, list(db.scalars(statement)))


@router.post("", response_model=MemberFieldCitationOut, status_code=201)
def create_citation(
    payload: MemberFieldCitationCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Cite a document for one field of a person.

    The document is linked to the person too when it wasn't yet, so it shows
    with their other documents.
    """
    get_member(db, tree, payload.member_id)
    document = db.get(Document, payload.document_id)
    if document is None or document.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Document not found")
    _require_write(db, context, payload.member_id, document.id)
    check_workspace_quota(db, tree, len(str(payload.model_dump()).encode()))
    now = utcnow_iso()
    citation = MemberFieldCitation(
        id=str(uuid4()),
        workspace_id=tree.id,
        member_id=payload.member_id,
        field=payload.field,
        document_id=document.id,
        created_by=user.id,
        created_at=now,
        updated_at=now,
    )
    _apply_anchor(db, citation, payload)
    with UnitOfWork(db) as uow:
        db.add(citation)
        if db.get(DocumentMemberLink, (document.id, payload.member_id)) is None:
            db.add(
                DocumentMemberLink(document_id=document.id, member_id=payload.member_id)
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    tree,
                    "workspace.content_changed",
                    {"workspace_id": tree.id, "domain": "document"},
                )
            )
        _record(db, uow, tree, user, payload.member_id)
    db.refresh(citation)
    return _outs(db, [citation])[0]


@router.patch("/{citation_id}", response_model=MemberFieldCitationOut)
def update_citation(
    citation_id: str,
    payload: MemberFieldCitationUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    citation = _get_citation(db, tree, citation_id)
    _require_write(db, context, citation.member_id, citation.document_id)
    check_workspace_quota(db, tree, len(str(payload.model_dump()).encode()))
    _apply_anchor(db, citation, payload)
    citation.updated_at = utcnow_iso()
    with UnitOfWork(db) as uow:
        _record(db, uow, tree, user, citation.member_id)
    db.refresh(citation)
    return _outs(db, [citation])[0]


@router.delete("/{citation_id}", status_code=204)
def delete_citation(
    citation_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    citation = _get_citation(db, tree, citation_id)
    _require_write(db, context, citation.member_id, citation.document_id)
    member_id = citation.member_id
    with UnitOfWork(db) as uow:
        db.delete(citation)
        _record(db, uow, tree, user, member_id)
