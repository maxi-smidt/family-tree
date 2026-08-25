"""Section-scoped public read links (#993).

``Workspace.public_role``/``public_password_hash``/``public_access_version``
remain the workspace-wide public link — the unscoped default every share used
before this landed. ``WorkspaceSectionPublicLink`` rows are *additional*,
independently passworded links restricted to one section each, so
consolidating same-owner trees can preserve several legacy public links
without merging them into one more-permissive link.

Both shapes are normalized into ``PublicGrant`` so ``app.api.deps`` can check
"is this workspace publicly readable at all, under any grant" without caring
which table a given link lives in.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import InvalidInputError
from app.core.security import hash_password
from app.db.base import utcnow_iso
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
    """Every currently-active public grant on this workspace."""
    grants: list[PublicGrant] = []
    workspace_grant = _workspace_grant(tree)
    if workspace_grant is not None:
        grants.append(workspace_grant)
    section_links = db.scalars(
        select(WorkspaceSectionPublicLink).where(
            WorkspaceSectionPublicLink.workspace_id == tree.id,
            WorkspaceSectionPublicLink.revoked_at.is_(None),
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
    if link is None or link.workspace_id != tree.id or link.revoked_at is not None:
        return None
    return PublicGrant(
        id=link.id,
        section_id=link.section_id,
        role=link.role,
        password_hash=link.password_hash,
        access_version=link.access_version,
    )


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


def revoke_section_public_link(link: WorkspaceSectionPublicLink) -> None:
    link.revoked_at = utcnow_iso()
    link.access_version += 1
