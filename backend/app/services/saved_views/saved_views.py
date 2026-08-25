"""CRUD, layout overlay, and per-user state for saved views (#986).

A saved view never serves its own content — it stores a configuration
(focus member, included sections, traversal depths, filters) that the caller
replays against the canonical bounded graph API
(``GET /workspaces/{id}/members/neighborhood``) and the ordinary member/content
endpoints. Editing a member "from" a saved view is just an ordinary member
write; nothing here mirrors or wraps that.

Reading a view always recomputes its *effective* config against the owner's
*current* access (``_effective_config``): a focus member or section the owner
can no longer read is degraded to absent rather than raised as an error, and
the stored config is left untouched underneath — access regained later (a
grant reinstated, etc.) makes it reappear. This is what keeps a scope
reduction (or the creator's own access loss) from ever destroying the view.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import (
    AccessDeniedError,
    ConflictError,
    InvalidInputError,
    NotFoundError,
)
from app.db.base import utcnow_iso
from app.db.upsert import upsert_row
from app.models import Member, Section, User, Workspace
from app.models.saved_view import (
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    SavedViewUserState,
)
from app.schemas.saved_view import (
    SavedViewCreate,
    SavedViewOut,
    SavedViewPositionItem,
    SavedViewUpdate,
)
from app.services.workspaces.visibility import (
    WorkspaceAccessContext,
    resolve_access_context,
)

SAVED_VIEW_STALE = "saved_view_changed_concurrently"


def _validate_focus_member(
    db: Session, tree: Workspace, context: WorkspaceAccessContext, member_id: str
) -> None:
    member = db.get(Member, member_id)
    if member is None or member.workspace_id != tree.id:
        raise InvalidInputError("Focus member not found in this workspace")
    if not context.unrestricted and not context.can_read_member(db, member_id):
        raise AccessDeniedError("No access to this member")


def _validate_section_ids(
    db: Session, tree: Workspace, context: WorkspaceAccessContext, section_ids: list[str]
) -> list[str]:
    unique_ids = sorted(set(section_ids))
    if not unique_ids:
        return []
    found = set(
        db.scalars(
            select(Section.id).where(
                Section.workspace_id == tree.id, Section.id.in_(unique_ids)
            )
        )
    )
    missing = set(unique_ids) - found
    if missing:
        raise InvalidInputError(f"Unknown section id(s): {', '.join(sorted(missing))}")
    if not context.unrestricted:
        visible = context.visible_section_ids() or frozenset()
        inaccessible = set(unique_ids) - visible
        if inaccessible:
            raise AccessDeniedError(
                f"No access to section(s): {', '.join(sorted(inaccessible))}"
            )
    return unique_ids


def _replace_sections(db: Session, view: SavedView, section_ids: list[str]) -> None:
    db.query(SavedViewSection).filter(
        SavedViewSection.saved_view_id == view.id
    ).delete(synchronize_session=False)
    for section_id in section_ids:
        db.add(
            SavedViewSection(
                saved_view_id=view.id,
                section_id=section_id,
                workspace_id=view.workspace_id,
            )
        )


def list_saved_views(db: Session, tree: Workspace, user: User) -> list[SavedView]:
    stmt = select(SavedView).where(SavedView.workspace_id == tree.id)
    if not user.is_admin:
        stmt = stmt.where(SavedView.owner_id == user.id)
    return list(db.scalars(stmt.order_by(SavedView.created_at)).all())


def get_owned_saved_view(
    db: Session, tree: Workspace, view_id: str, user: User
) -> SavedView:
    view = db.get(SavedView, view_id)
    if view is None or view.workspace_id != tree.id:
        raise NotFoundError("Saved view not found")
    if view.owner_id != user.id and not user.is_admin:
        raise NotFoundError("Saved view not found")
    return view


def create_saved_view(
    db: Session,
    tree: Workspace,
    user: User,
    context: WorkspaceAccessContext,
    payload: SavedViewCreate,
) -> SavedView:
    if payload.focus_member_id is not None:
        _validate_focus_member(db, tree, context, payload.focus_member_id)
    section_ids = _validate_section_ids(db, tree, context, payload.section_ids)
    now = utcnow_iso()
    view = SavedView(
        workspace_id=tree.id,
        owner_id=user.id,
        name=payload.name.strip(),
        focus_member_id=payload.focus_member_id,
        ancestor_depth=payload.ancestor_depth,
        descendant_depth=payload.descendant_depth,
        include_partners=payload.include_partners,
        filters=payload.filters,
        created_at=now,
        updated_at=now,
    )
    db.add(view)
    db.flush()
    _replace_sections(db, view, section_ids)
    return view


def update_saved_view(
    db: Session,
    tree: Workspace,
    view: SavedView,
    context: WorkspaceAccessContext,
    payload: SavedViewUpdate,
) -> SavedView:
    if view.version != payload.expected_version:
        raise ConflictError(SAVED_VIEW_STALE)
    if payload.name is not None:
        view.name = payload.name.strip()
    if payload.clear_focus_member:
        view.focus_member_id = None
    elif payload.focus_member_id is not None:
        _validate_focus_member(db, tree, context, payload.focus_member_id)
        view.focus_member_id = payload.focus_member_id
    if payload.section_ids is not None:
        section_ids = _validate_section_ids(db, tree, context, payload.section_ids)
        _replace_sections(db, view, section_ids)
    if payload.ancestor_depth is not None:
        view.ancestor_depth = payload.ancestor_depth
    if payload.descendant_depth is not None:
        view.descendant_depth = payload.descendant_depth
    if payload.include_partners is not None:
        view.include_partners = payload.include_partners
    if payload.filters is not None:
        view.filters = payload.filters
    view.updated_at = utcnow_iso()
    return view


def delete_saved_view(db: Session, view: SavedView) -> None:
    db.delete(view)


def upsert_saved_view_positions(
    db: Session, view: SavedView, items: list[tuple[str, float, float]]
) -> None:
    if not items:
        return
    existing = {
        p.node_id: p
        for p in db.scalars(
            select(SavedViewPosition).where(SavedViewPosition.saved_view_id == view.id)
        )
    }
    for node_id, position_x, position_y in items:
        row = existing.get(node_id)
        if row is not None:
            row.position_x = position_x
            row.position_y = position_y
        else:
            db.add(
                SavedViewPosition(
                    saved_view_id=view.id,
                    node_id=node_id,
                    position_x=position_x,
                    position_y=position_y,
                )
            )


def mark_view_opened(db: Session, view_id: str, user_id: str) -> None:
    upsert_row(
        db,
        SavedViewUserState,
        {"saved_view_id": view_id, "user_id": user_id, "last_opened": utcnow_iso()},
        index_elements=["saved_view_id", "user_id"],
    )


def view_last_opened(db: Session, view_id: str, user_id: str) -> str | None:
    state = db.get(SavedViewUserState, (view_id, user_id))
    return state.last_opened if state else None


def get_user_state(db: Session, view_id: str, user_id: str) -> SavedViewUserState | None:
    return db.get(SavedViewUserState, (view_id, user_id))


def update_user_state(
    db: Session,
    view_id: str,
    user_id: str,
    *,
    camera_x: float | None,
    camera_y: float | None,
    camera_zoom: float | None,
    collapsed_node_ids: list[str] | None,
) -> SavedViewUserState:
    state = db.get(SavedViewUserState, (view_id, user_id))
    if state is None:
        state = SavedViewUserState(
            saved_view_id=view_id, user_id=user_id, last_opened=utcnow_iso()
        )
        db.add(state)
    if camera_x is not None:
        state.camera_x = camera_x
    if camera_y is not None:
        state.camera_y = camera_y
    if camera_zoom is not None:
        state.camera_zoom = camera_zoom
    if collapsed_node_ids is not None:
        state.collapsed_node_ids = collapsed_node_ids
    return state


def _effective_config(
    db: Session, tree: Workspace, view: SavedView
) -> tuple[str | None, list[str]]:
    """Degrade ``view``'s config to what its owner may currently read.

    A creator who is a scoped collaborator (rather than the workspace owner)
    only ever sees this narrowed view of their own configuration too — the
    same rule applies uniformly regardless of who is asking.
    """
    owner = db.get(User, view.owner_id)
    section_ids = [s.section_id for s in view.sections]
    if owner is None:
        return None, []
    context = resolve_access_context(db, tree, owner)
    if context.unrestricted:
        return view.focus_member_id, section_ids
    visible = context.visible_section_ids() or frozenset()
    focus_member_id = view.focus_member_id
    if focus_member_id is not None and not context.can_read_member(db, focus_member_id):
        focus_member_id = None
    return focus_member_id, [sid for sid in section_ids if sid in visible]


def saved_view_out(
    db: Session, tree: Workspace, view: SavedView, *, last_opened: str | None = None
) -> SavedViewOut:
    focus_member_id, section_ids = _effective_config(db, tree, view)
    return SavedViewOut(
        id=view.id,
        workspace_id=view.workspace_id,
        owner_id=view.owner_id,
        name=view.name,
        focus_member_id=focus_member_id,
        section_ids=sorted(section_ids),
        ancestor_depth=view.ancestor_depth,
        descendant_depth=view.descendant_depth,
        include_partners=view.include_partners,
        filters=view.filters,
        config_version=view.config_version,
        version=view.version,
        created_at=view.created_at,
        updated_at=view.updated_at,
        last_opened=last_opened,
        positions=[
            SavedViewPositionItem(
                node_id=p.node_id, position_x=p.position_x, position_y=p.position_y
            )
            for p in view.positions
        ],
    )


def degrade_saved_views_for_member(
    db: Session, workspace_id: str, member_id: str
) -> None:
    """Repair saved views before a member is deleted.

    The focus-member FK is RESTRICT (see ``models.saved_view``), so a member
    referenced by any saved view would otherwise block its own deletion —
    clear the reference (and this member's position overlay, now meaningless)
    first, degrading each affected view instead of losing it or the member.

    ``node_id`` on a position overlay is an unvalidated string (real member
    id or a synthetic anchor — see ``models.saved_view.SavedViewPosition``),
    so its cleanup is scoped through ``workspace_id`` explicitly rather than
    matching ``member_id`` globally: nothing stops a client writing another
    workspace's member id there, and this must never reach across workspaces
    to delete an unrelated view's overlay.
    """
    db.query(SavedView).filter(
        SavedView.workspace_id == workspace_id, SavedView.focus_member_id == member_id
    ).update({SavedView.focus_member_id: None}, synchronize_session=False)
    view_ids = select(SavedView.id).where(SavedView.workspace_id == workspace_id)
    db.query(SavedViewPosition).filter(
        SavedViewPosition.node_id == member_id,
        SavedViewPosition.saved_view_id.in_(view_ids),
    ).delete(synchronize_session=False)


def repoint_saved_views_for_merge(
    db: Session, workspace_id: str, keep_id: str, remove_id: str
) -> None:
    """Carry ``remove``'s saved-view references onto ``keep`` before an
    in-place member merge deletes ``remove`` — a merge means "these are the
    same person now", so a view degrades only if ``keep`` truly has nothing
    there yet, never just because the id it was pointing at changed.

    Scoped through ``workspace_id`` for the same reason as
    ``degrade_saved_views_for_member``: ``node_id`` is an unvalidated string,
    not necessarily a member of this workspace at all.
    """
    db.query(SavedView).filter(
        SavedView.workspace_id == workspace_id, SavedView.focus_member_id == remove_id
    ).update({SavedView.focus_member_id: keep_id}, synchronize_session=False)
    view_ids = select(SavedView.id).where(SavedView.workspace_id == workspace_id)
    moved = list(
        db.scalars(
            select(SavedViewPosition).where(
                SavedViewPosition.node_id == remove_id,
                SavedViewPosition.saved_view_id.in_(view_ids),
            )
        )
    )
    for row in moved:
        keep_row = db.get(SavedViewPosition, (row.saved_view_id, keep_id))
        db.delete(row)
        if keep_row is None:
            db.flush()
            db.add(
                SavedViewPosition(
                    saved_view_id=row.saved_view_id,
                    node_id=keep_id,
                    position_x=row.position_x,
                    position_y=row.position_y,
                )
            )


def drop_saved_view_section(db: Session, section_id: str) -> None:
    """Repair saved views before a section is deleted.

    Mirrors ``degrade_saved_views_for_member``: a view's section filter
    simply narrows by one entry rather than blocking the section's delete.
    """
    db.query(SavedViewSection).filter(
        SavedViewSection.section_id == section_id
    ).delete(synchronize_session=False)
