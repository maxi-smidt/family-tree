"""Shared FastAPI dependencies: authentication and tree authorization."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import Tree, TreeMembership, User

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
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )
    return user


def require_feature(feature: str):
    """Dependency factory gating a router/endpoint behind a feature flag.

    Disabled features answer 404 (not 403) so they are indistinguishable from
    routes that never existed — hiding a tab in the UI is not enough, the API
    surface has to disappear too. Flags apply to admins like everyone else;
    admins can flip the flag via the admin API instead.
    """
    from app.services import feature_service

    if feature not in feature_service.FEATURES:  # fail fast on typos at import
        raise ValueError(f"Unknown feature flag: {feature}")

    def dependency(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> None:
        if not feature_service.is_enabled(db, feature, user):
            raise HTTPException(status_code=404, detail="Not found")

    return dependency


def require_domain(domain: str):
    """Dependency factory hiding a content domain from a restricted member.

    Mirrors require_feature: restricted domains answer 404 so they are
    indistinguishable from disabled features. Owners, admins, and public
    viewers have no membership row and always pass.
    """
    from app.services import feature_service

    if domain not in feature_service.RESTRICTABLE_DOMAINS:
        raise ValueError(f"Unknown restrictable domain: {domain}")

    def dependency(
        tree_id: str,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> None:
        membership = db.get(TreeMembership, (tree_id, user.id))
        if (
            membership
            and membership.restrictions
            and domain in membership.restrictions
        ):
            raise HTTPException(status_code=404, detail="Not found")

    return dependency


def role_for(db: Session, tree: Tree, user: User) -> str | None:
    """The user's genuine relationship to the tree: 'owner' | 'editor' |
    'viewer', or None when they have no explicit access.

    Admin god-mode is intentionally NOT applied here: an admin who has been
    granted access to someone else's tree should see their real role (e.g.
    editor) instead of appearing as the owner. Admin authorization is enforced
    separately in ``_resolve_tree``. Admins with no explicit grant still fall
    back to 'owner' so every tree they can see lands in a sensible bucket.
    """
    if tree.owner_id == user.id:
        return "owner"
    membership = db.get(TreeMembership, (tree.id, user.id))
    if membership:
        return membership.role
    return "owner" if user.is_admin else None


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


def _resolve_tree(
    db: Session, tree_id: str, user: User | None, *, write: bool
) -> Tree:
    tree = db.get(Tree, tree_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="Tree not found")

    if user is None:
        # Anonymous requests succeed only for public read-only trees.
        if not write and tree.public_role == "viewer":
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

    # Authenticated users: check role. Public trees are still accessible to
    # authenticated users who have no explicit membership.
    role = role_for(db, tree, user)
    if role is None:
        if not write and tree.public_role == "viewer":
            return tree
        raise HTTPException(status_code=403, detail="No access to this tree")
    if write and role == "viewer":
        raise HTTPException(status_code=403, detail="Read-only access to this tree")
    return tree


def get_readable_tree(
    tree_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Tree:
    return _resolve_tree(db, tree_id, user, write=False)


def get_readable_tree_public(
    tree_id: str,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> Tree:
    """Like get_readable_tree but allows anonymous access to public trees."""
    return _resolve_tree(db, tree_id, user, write=False)


def get_writable_tree(
    tree_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Tree:
    return _resolve_tree(db, tree_id, user, write=True)


def explicit_tree_ids(db: Session, user: User) -> list[str]:
    owned = db.scalars(select(Tree.id).where(Tree.owner_id == user.id)).all()
    shared = db.scalars(
        select(TreeMembership.tree_id).where(TreeMembership.user_id == user.id)
    ).all()
    return list({*owned, *shared})


def accessible_tree_ids(db: Session, user: User) -> list[str]:
    if user.is_admin:
        return [t.id for t in db.scalars(select(Tree)).all()]
    return explicit_tree_ids(db, user)
