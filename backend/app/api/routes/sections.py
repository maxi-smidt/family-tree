"""CRUD for sections, their membership, and their per-section layout (#982)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_workspace_access,
    get_workspace_access_write,
    get_writable_workspace,
)
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models import Workspace
from app.models.user import User
from app.schemas.extract import Direction
from app.schemas.family import MemberSurfaceOut
from app.schemas.provenance import SectionDependents
from app.schemas.section import (
    SectionCreate,
    SectionMembersSet,
    SectionOut,
    SectionPositionItem,
    SectionPreview,
    SectionSuggestion,
    SectionUpdate,
)
from app.services.activity.activity import record_activity
from app.services.event_bus import publish_workspace_event
from app.services.sections import (
    compute_section_preview,
    create_section,
    delete_section,
    get_section,
    list_sections,
    member_counts,
    replace_section_members,
    section_dependents,
    section_member_rows,
    section_out,
    suggest_sections_for_member,
    update_section,
    upsert_section_positions,
)
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(prefix="/workspaces/{workspace_id}/sections", tags=["sections"])


def _content_changed(db: Session, tree: Workspace) -> None:
    publish_workspace_event(
        db,
        tree,
        "workspace.content_changed",
        {"workspace_id": tree.id, "domain": "section"},
    )


def _activity_added(db: Session, tree: Workspace) -> None:
    publish_workspace_event(db, tree, "activity.entry_added", {"workspace_id": tree.id})


def _get_readable_section(
    db: Session, tree: Workspace, section_id: str, context: WorkspaceAccessContext
):
    """Load a section for a read, 404ing if this context's grants don't
    reach it (#1029) — a scoped grant must not reveal sections outside it."""
    section = get_section(db, tree, section_id)
    if not context.can_read_scope(section.id):
        raise NotFoundError("Section not found")
    return section


def _get_writable_section(
    db: Session, tree: Workspace, section_id: str, context: WorkspaceAccessContext
):
    """Load a section for a write: 404 if unreadable, 403 if readable but
    this context's grant on it isn't an editor grant."""
    section = _get_readable_section(db, tree, section_id, context)
    context.require_write_scope(section.id)
    return section


@router.get("", response_model=list[SectionOut])
def get_sections(
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
):
    sections = list_sections(db, tree)
    return [
        s.model_copy(update={"can_write": context.can_write_scope(s.id)})
        for s in sections
        if context.can_read_scope(s.id)
    ]


@router.get("/preview", response_model=SectionPreview)
def preview_section(
    root_member_id: str,
    direction: Direction = "direct_family",
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
):
    return compute_section_preview(db, tree, root_member_id, direction)


@router.get("/suggestions", response_model=list[SectionSuggestion])
def get_section_suggestions(
    member_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
):
    suggestions = suggest_sections_for_member(db, tree, member_id)
    counts = member_counts(db, [section.id for section, _ in suggestions])
    return [
        SectionSuggestion(
            section=section_out(section, counts.get(section.id, 0)),
            matched_via_member_ids=via,
        )
        for section, via in suggestions
    ]


@router.post("", response_model=SectionOut, status_code=201)
def post_section(
    payload: SectionCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        with UnitOfWork(db) as uow:
            section = create_section(
                db,
                tree,
                name=payload.name,
                root_member_id=payload.root_member_id,
                direction=payload.direction,
            )
            record_activity(
                db,
                workspace_id=tree.id,
                actor=user,
                action="create",
                target_type="section",
                target_id=section.id,
                target_label=section.name,
            )
            uow.after_commit(lambda: _activity_added(db, tree))
            uow.after_commit(lambda: _content_changed(db, tree))
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409, detail="A section with this name already exists"
        ) from exc
    db.refresh(section)
    return section_out(section, len(section.members))


@router.get("/{section_id}", response_model=SectionOut)
def get_section_by_id(
    section_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
):
    section = _get_readable_section(db, tree, section_id, context)
    out = section_out(section, len(section.members))
    return out.model_copy(update={"can_write": context.can_write_scope(section.id)})


@router.patch("/{section_id}", response_model=SectionOut)
def patch_section(
    section_id: str,
    payload: SectionUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    section = _get_writable_section(db, tree, section_id, context)
    try:
        with UnitOfWork(db) as uow:
            update_section(
                db, tree, section, name=payload.name, position=payload.position
            )
            record_activity(
                db,
                workspace_id=tree.id,
                actor=user,
                action="update",
                target_type="section",
                target_id=section.id,
                target_label=section.name,
            )
            uow.after_commit(lambda: _activity_added(db, tree))
            uow.after_commit(lambda: _content_changed(db, tree))
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409, detail="A section with this name already exists"
        ) from exc
    db.refresh(section)
    return section_out(section, len(section.members))


@router.get("/{section_id}/members", response_model=list[MemberSurfaceOut])
def get_section_members(
    section_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
):
    """Members currently in this section — the read side of membership
    editing (#990); ``PUT .../members`` is a full replace, so the editor UI
    needs this to know what it's replacing."""
    section = _get_readable_section(db, tree, section_id, context)
    return [
        MemberSurfaceOut(**row._mapping)
        for row in section_member_rows(db, tree, section)
    ]


@router.get("/{section_id}/dependents", response_model=SectionDependents)
def get_section_dependents(
    section_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
):
    """What deleting this section would have to account for first."""
    return section_dependents(db, _get_readable_section(db, tree, section_id, context))


@router.delete("/{section_id}", status_code=204)
def remove_section(
    section_id: str,
    reassign_scope_to: str | None = None,
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    section = _get_writable_section(db, tree, section_id, context)
    if reassign_scope_to is not None:
        # The reassignment target absorbs this section's content, so writing
        # to it needs the same authorization as writing to the section being
        # deleted — otherwise a scoped editor could dump content into a
        # section they have no editor grant on.
        _get_writable_section(db, tree, reassign_scope_to, context)
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="delete",
            target_type="section",
            target_id=section.id,
            target_label=section.name,
        )
        delete_section(db, tree, section, reassign_scope_to=reassign_scope_to)
        uow.after_commit(lambda: _activity_added(db, tree))
        uow.after_commit(lambda: _content_changed(db, tree))


@router.put("/{section_id}/members", status_code=204)
def put_section_members(
    section_id: str,
    payload: SectionMembersSet,
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    section = _get_writable_section(db, tree, section_id, context)
    with UnitOfWork(db) as uow:
        replace_section_members(db, tree, section, payload.member_ids)
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="section",
            target_id=section.id,
            target_label=section.name,
        )
        uow.after_commit(lambda: _activity_added(db, tree))
        uow.after_commit(lambda: _content_changed(db, tree))


@router.patch("/{section_id}/members/positions", status_code=204)
def patch_section_positions(
    section_id: str,
    payload: list[SectionPositionItem],
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    section = _get_writable_section(db, tree, section_id, context)
    if not payload:
        return
    items = [(p.member_id, p.position_x, p.position_y) for p in payload]
    with UnitOfWork(db) as uow:
        upsert_section_positions(db, section, items)
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "workspace.layout_changed", {"workspace_id": tree.id}
            )
        )
