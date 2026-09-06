"""Section-scoped public read links (#993).

``Workspace.public_role``/``public_password_hash``/``public_access_version``
remain the workspace-wide public link — the unscoped default every share used
before this landed. ``WorkspaceSectionPublicLink`` rows are *additional*,
independently passworded links restricted to one section each, so
consolidating same-owner trees can preserve several legacy public links
without merging them into one more-permissive link.

Both shapes are normalized into ``PublicGrant`` so callers don't care which
table a given link lives in. ``active_public_grants``/``resolve_public_grant``
verify a grant's own password/version correctly for both;
``resolve_public_grant_for_read`` is what ``app.api.deps`` uses to decide
*which* grant — workspace-wide or one specific section — governs an anonymous
request, now that #984's visibility resolver enforces the section boundary on
every read path a section grant reaches.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import InvalidInputError
from app.core.security import decode_public_tree_token, hash_password
from app.models import Workspace, WorkspaceSectionPublicLink

# Sentinel id for the workspace-wide link (the ``Workspace`` row's own
# public_* fields), distinct from any WorkspaceSectionPublicLink uuid.
WORKSPACE_LINK_ID = "workspace"


@dataclass(frozen=True)
class PublicGrant:
    id: str
    # None = workspace-wide.
    section_id: str | None
    role: str
    password_hash: str | None
    access_version: int


def _workspace_grant(tree: Workspace) -> PublicGrant | None:
    if tree.public_role is None:
        return None
    return PublicGrant(
        id=WORKSPACE_LINK_ID,
        section_id=None,
        role=tree.public_role,
        password_hash=tree.public_password_hash,
        access_version=tree.public_access_version,
    )


def active_public_grants(db: Session, tree: Workspace) -> list[PublicGrant]:
    """Every currently-active public grant on this workspace.

    Every ``WorkspaceSectionPublicLink`` row is by definition active —
    revoking one deletes it (see ``revoke_section_public_link``) — so this
    only needs to add the workspace-wide link when it's enabled.
    """
    grants: list[PublicGrant] = []
    workspace_grant = _workspace_grant(tree)
    if workspace_grant is not None:
        grants.append(workspace_grant)
    section_links = db.scalars(
        select(WorkspaceSectionPublicLink).where(
            WorkspaceSectionPublicLink.workspace_id == tree.id
        )
    )
    grants.extend(
        PublicGrant(
            id=link.id,
            section_id=link.section_id,
            role=link.role,
            password_hash=link.password_hash,
            access_version=link.access_version,
        )
        for link in section_links
    )
    return grants


def resolve_public_grant(
    db: Session, tree: Workspace, link_id: str | None
) -> PublicGrant | None:
    """The grant a caller is attempting to unlock: the workspace-wide link
    when ``link_id`` is ``None`` or the sentinel, otherwise a specific
    section link. Never crosses a workspace boundary."""
    if link_id is None or link_id == WORKSPACE_LINK_ID:
        return _workspace_grant(tree)
    link = db.get(WorkspaceSectionPublicLink, link_id)
    if link is None or link.workspace_id != tree.id:
        return None
    return PublicGrant(
        id=link.id,
        section_id=link.section_id,
        role=link.role,
        password_hash=link.password_hash,
        access_version=link.access_version,
    )


def resolve_public_grant_for_read(
    db: Session, tree: Workspace, public_token: str | None
) -> PublicGrant | None:
    """The public grant governing an anonymous *read*, or ``None`` to deny it.

    With a token, it must decode for this workspace and match a currently
    active grant's id and access version exactly — the same check
    ``unlock_public_tree`` runs, so a stale or foreign token never resolves.
    Without one, only the workspace-wide grant can apply, and only when it
    carries no password — the exact anonymous-access shape that predates
    section-scoped links, preserved so an unprotected workspace-wide link
    keeps working with no token round-trip.
    """
    if public_token:
        try:
            workspace_id, access_version, grant_id = decode_public_tree_token(
                public_token
            )
        except Exception:  # noqa: BLE001 - any decode failure means no access
            return None
        if workspace_id != tree.id:
            return None
        grant = resolve_public_grant(db, tree, grant_id)
        if grant is None or grant.access_version != access_version:
            return None
        return grant
    workspace_grant = _workspace_grant(tree)
    if workspace_grant is not None and workspace_grant.password_hash is None:
        return workspace_grant
    return None


# ---------------------------------------------------------------------------
# Section public-link management (used directly by migration/tests; no
# owner-facing route exists yet — richer section-sharing UX is a follow-up
# per #993/#980, same as the section-grant management below in
# ``app.services.workspaces.grants``).
# ---------------------------------------------------------------------------


def create_section_public_link(
    db: Session, *, workspace_id: str, section_id: str, role: str = "viewer"
) -> WorkspaceSectionPublicLink:
    if role != "viewer":
        raise InvalidInputError("Invalid role")
    link = WorkspaceSectionPublicLink(
        workspace_id=workspace_id, section_id=section_id, role=role, access_version=0
    )
    db.add(link)
    return link


def set_section_public_link_password(
    link: WorkspaceSectionPublicLink, password: str | None
) -> None:
    link.password_hash = hash_password(password) if password else None
    link.access_version += 1


def revoke_section_public_link(db: Session, link: WorkspaceSectionPublicLink) -> None:
    """Delete the link outright (mirrors ``revoke_section_grant``) so a
    revoked link neither remains unlockable nor permanently blocks its
    section from being deleted via the still-referencing FK row."""
    db.delete(link)
