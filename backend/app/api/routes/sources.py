"""Source citations and evidence records for member facts."""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

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
from app.models import Citation, Member, Source, SourceEvidence, Tree
from app.models.user import User
from app.schemas.content import (
    CitationCreate,
    CitationOut,
    CitationUpdate,
    EvidenceCreate,
    EvidenceOut,
    EvidenceUpdate,
    SourceCreate,
    SourceOut,
    SourceUpdate,
)
from app.services.activity import record_activity
from app.services.settings_service import get_media_limits
from app.services.storage import (
    FileTooLarge,
    UnsupportedFileType,
    delete_media,
    store_document,
)

router = APIRouter(
    prefix="/trees/{tree_id}/sources",
    tags=["sources"],
    dependencies=[
        Depends(require_feature("sources")),
        Depends(require_domain("sources")),
    ],
)

_MEDIA_PREFIX = "/api/media/"


def _get_source(db: Session, tree: Tree, source_id: str) -> Source:
    source = db.get(Source, source_id)
    if source is None or source.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


def _get_evidence(db: Session, source: Source, evidence_id: str) -> SourceEvidence:
    ev = db.get(SourceEvidence, evidence_id)
    if ev is None or ev.source_id != source.id:
        raise HTTPException(status_code=404, detail="Evidence not found")
    return ev


def _get_citation(db: Session, tree: Tree, citation_id: str) -> Citation:
    cit = db.get(Citation, citation_id)
    if cit is None or cit.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Citation not found")
    return cit


@router.get("", response_model=list[SourceOut])
def list_sources(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(Source)
        .where(Source.tree_id == tree.id)
        .order_by(Source.created_at, Source.id)
        .options(selectinload(Source.evidence))
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("", response_model=SourceOut, status_code=201)
def create_source(
    payload: SourceCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    source = Source(tree_id=tree.id, **data)
    db.add(source)
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="create",
        target_type="source",
        target_id=source.id,
        target_label=source.title,
    )
    db.commit()
    db.refresh(source)
    return source


@router.patch("/{source_id}", response_model=SourceOut)
def update_source(
    source_id: str,
    payload: SourceUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    source = _get_source(db, tree, source_id)
    for key, value in payload.model_dump().items():
        setattr(source, key, value)
    source.updated_at = utcnow_iso()
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="source",
        target_id=source.id,
        target_label=source.title,
    )
    db.commit()
    db.refresh(source)
    return source


@router.delete("/{source_id}", status_code=204)
def delete_source(
    source_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    source = _get_source(db, tree, source_id)
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="delete",
        target_type="source",
        target_id=source.id,
        target_label=source.title,
    )
    for ev in source.evidence:
        if ev.kind == "file":
            delete_media(ev.url)
    db.delete(source)
    db.commit()


# --- Evidence ----------------------------------------------------------------


@router.post("/{source_id}/evidence", response_model=EvidenceOut, status_code=201)
def add_evidence(
    source_id: str,
    payload: EvidenceCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    source = _get_source(db, tree, source_id)

    if payload.kind == "file":
        if not payload.filename or not payload.data:
            raise HTTPException(
                status_code=400, detail="filename and data are required for file evidence"
            )
        try:
            url, mime, size = store_document(
                tree.id,
                payload.filename,
                payload.data,
                get_media_limits(db),
            )
        except FileTooLarge as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except UnsupportedFileType as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        ev = SourceEvidence(
            id=str(uuid4()),
            tree_id=tree.id,
            source_id=source.id,
            kind="file",
            filename=payload.filename,
            url=url,
            mime_type=mime,
            size=size,
            created_at=utcnow_iso(),
        )
    else:
        link_url = (payload.url or "").strip()
        if not link_url:
            raise HTTPException(
                status_code=400, detail="url is required for link evidence"
            )
        if link_url.startswith("data:") or link_url.startswith(_MEDIA_PREFIX):
            raise HTTPException(status_code=400, detail="Invalid link URL")

        ev = SourceEvidence(
            id=str(uuid4()),
            tree_id=tree.id,
            source_id=source.id,
            kind="link",
            filename=payload.filename,
            url=link_url,
            mime_type=None,
            size=None,
            created_at=utcnow_iso(),
        )

    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


@router.patch(
    "/{source_id}/evidence/{evidence_id}", response_model=EvidenceOut
)
def rename_evidence(
    source_id: str,
    evidence_id: str,
    payload: EvidenceUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    source = _get_source(db, tree, source_id)
    ev = _get_evidence(db, source, evidence_id)
    ev.filename = payload.filename
    db.commit()
    db.refresh(ev)
    return ev


@router.delete("/{source_id}/evidence/{evidence_id}", status_code=204)
def delete_evidence(
    source_id: str,
    evidence_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    source = _get_source(db, tree, source_id)
    ev = _get_evidence(db, source, evidence_id)
    if ev.kind == "file":
        delete_media(ev.url)
    db.delete(ev)
    db.commit()


# --- Citations ----------------------------------------------------------------


@router.get("/citations", response_model=list[CitationOut])
def list_citations(
    member_id: str | None = Query(default=None),
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(Citation)
        .where(Citation.tree_id == tree.id)
        .order_by(Citation.created_at, Citation.id)
    )
    if member_id:
        statement = statement.where(Citation.member_id == member_id)
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/citations", response_model=CitationOut, status_code=201)
def create_citation(
    payload: CitationCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    if db.get(Source, payload.source_id) is None or (
        db.query(Source).filter(
            Source.id == payload.source_id, Source.tree_id == tree.id
        ).first()
        is None
    ):
        raise HTTPException(status_code=404, detail="Source not found")
    if (
        db.query(Member).filter(
            Member.id == payload.member_id, Member.tree_id == tree.id
        ).first()
        is None
    ):
        raise HTTPException(status_code=404, detail="Member not found")

    data = payload.model_dump()
    cit = Citation(tree_id=tree.id, **data)
    db.add(cit)
    db.commit()
    db.refresh(cit)
    return cit


@router.patch("/citations/{citation_id}", response_model=CitationOut)
def update_citation(
    citation_id: str,
    payload: CitationUpdate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    cit = _get_citation(db, tree, citation_id)
    for key, value in payload.model_dump().items():
        setattr(cit, key, value)
    db.commit()
    db.refresh(cit)
    return cit


@router.delete("/citations/{citation_id}", status_code=204)
def delete_citation(
    citation_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    cit = _get_citation(db, tree, citation_id)
    db.delete(cit)
    db.commit()
