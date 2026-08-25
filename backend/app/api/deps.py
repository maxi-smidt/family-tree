"""Shared FastAPI dependencies: authentication and tree authorization."""

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_access_token, decode_public_tree_token
from app.db.session import get_db
from app.models import User, Workspace, WorkspaceMembership, WorkspaceSectionGrant
from app.services.provenance import bind_origin_section, resolve_origin_section
from app.services.workspace_roles import role_for
from app.services.workspaces.grants import permitted_section_ids, restricts_domain
from app.services.workspaces.public_links import WORKSPACE_LINK_ID

_bearer = HTTPBearer(auto_error=False)

# Stable detail code returned to the frontend when login is refused because the
# account is pending deletion, so it can show a dedicated translated message.
ACCOUNT_PENDING_DELETION = "account_pending_deletion"


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception as exc:  # noqa: BLE001 - any decode failure is a 401
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc

    user = db.get(User, payload.get("sub"))
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or unknown user"
        )
    # Reject accounts pending deletion. A 401 (rather than 403) lets the existing
    # global handler bounce live sessions back to the login screen, where the
    # dedicated pending-deletion message is shown on the next attempt.
    if user.deletion_requested_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=ACCOUNT_PENDING_DELETION
        )
    # Workspace-change SSE events use the request-scoped session to identify the
    # editor for live-presence highlighting.
    db.info["workspace_event_actor_id"] = user.id
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )
    return user


def require_domain(domain: str):
    """Hide a content domain from a restricted shared-tree member.

    Owners, admins, and public viewers have no grant at all and always pass.
    A user with several grants (#993) passes as long as at least one of them
    doesn't restrict the domain — fine per-section domain enforcement is
    #984's job; this stays the coarse workspace-level gate it always was.
    """
    from app.services.workspaces.restrictions import RESTRICTABLE_DOMAINS

    if domain not in RESTRICTABLE_DOMAINS:
        raise ValueError(f"Unknown restrictable domain: {domain}")

    def dependency(
        workspace_id: str,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> None:
        if restricts_domain(db, workspace_id, user.id, domain):
            raise HTTPException(status_code=404, detail="Not found")

    return dependency


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """Like get_current_user but returns None instead of raising on missing creds."""
    if credentials is None:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception:  # noqa: BLE001
        return None
    user = db.get(User, payload.get("sub"))
    if user is None or not user.is_active or user.deletion_requested_at is not None:
        return None
    return user


def _public_access_ok(tree: Workspace, public_token: str | None) -> bool:
    """True if the workspace-wide public link needs no password, or the
    supplied unlock token is valid for it.

    Deliberately narrower than "some active public grant, any scope": a
    section-scoped ``WorkspaceSectionPublicLink`` (#993) unlocks and mints
    its own token (see ``workspace_public.unlock_public_tree``), but that
    token must not grant this coarse, unscoped read of the *whole*
    workspace — there is no per-section content filter yet to keep it to its
    own section (that choke point is #984's job). Wiring it in here first
    would let anyone who knew one constituent tree's old public password
    read every other section a consolidated workspace now contains.
    """
    if not tree.public_password_hash:
        return True
    if not public_token:
        return False
    try:
        workspace_id, access_version, grant_id = decode_public_tree_token(public_token)
        return (
            workspace_id == tree.id
            and grant_id == WORKSPACE_LINK_ID
            and access_version == tree.public_access_version
        )
    except Exception:  # noqa: BLE001 - any decode failure means no access
        return False


def _resolve_workspace(
    db: Session,
    workspace_id: str,
    user: User | None,
    *,
    write: bool,
    public_token: str | None = None,
) -> Workspace:
    tree = db.get(Workspace, workspace_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if user is None:
        # Anonymous requests succeed only for public read-only workspaces.
        if not write and tree.public_role == "viewer":
            if not _public_access_ok(tree, public_token):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="public_password_required",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            return tree
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Admins always have full read/write access, regardless of any explicit
    # (possibly read-only) membership they were granted.
    if user.is_admin:
        return tree

    # Authenticated users: check role. Public workspaces are still accessible to
    # authenticated users who have no explicit membership.
    role = role_for(db, tree, user)
    if role is None:
        if not write and tree.public_role == "viewer":
            if not _public_access_ok(tree, public_token):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="public_password_required",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            return tree
        raise HTTPException(status_code=403, detail="No access to this tree")
    if write and role == "viewer":
        raise HTTPException(status_code=403, detail="Read-only access to this tree")
    return tree


def get_readable_workspace(
    workspace_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Workspace:
    return _resolve_workspace(db, workspace_id, user, write=False)


def get_readable_workspace_public(
    workspace_id: str,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
    public_token: str | None = Header(None, alias="X-Public-Workspace-Token"),
) -> Workspace:
    """Like get_readable_workspace but allows anonymous access to public workspaces."""
    return _resolve_workspace(
        db, workspace_id, user, write=False, public_token=public_token
    )


def get_writable_workspace(
    workspace_id: str,
    origin_section_id: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Workspace:
    """Authorize a write and bind the origin scope its content inherits.

    ``origin_section_id`` names the section the caller is working in. Binding
    it here rather than in each route means every content write in the API —
    and every write a route delegates to a service — records provenance
    through the same path (#1023).
    """
    from app.services.system.settings_service import user_has_accepted_legal

    if not user_has_accepted_legal(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Legal terms must be accepted before making changes",
        )
    tree = _resolve_workspace(db, workspace_id, user, write=True)
    permitted = (
        None
        if user.is_admin or tree.owner_id == user.id
        else permitted_section_ids(db, tree.id, user.id)
    )
    bind_origin_section(
        db,
        resolve_origin_section(
            db, tree, origin_section_id, permitted_section_ids=permitted
        ),
    )
    return tree


def explicit_workspace_ids(db: Session, user: User) -> list[str]:
    owned = db.scalars(select(Workspace.id).where(Workspace.owner_id == user.id)).all()
    shared = db.scalars(
        select(WorkspaceMembership.workspace_id).where(
            WorkspaceMembership.user_id == user.id
        )
    ).all()
    # A user with only a section-scoped grant (#993) has no WorkspaceMembership
    # row at all, so they'd otherwise be missing from their own workspace list.
    section_scoped = db.scalars(
        select(WorkspaceSectionGrant.workspace_id).where(
            WorkspaceSectionGrant.user_id == user.id
        )
    ).all()
    return list({*owned, *shared, *section_scoped})


def accessible_workspace_ids(db: Session, user: User) -> list[str]:
    if user.is_admin:
        return [t.id for t in db.scalars(select(Workspace)).all()]
    return explicit_workspace_ids(db, user)
