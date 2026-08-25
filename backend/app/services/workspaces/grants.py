"""The normalized v2 grant model (#993): section-scoped access that can
differ from a user's workspace-wide membership.

A collaborator migrated from same-owner v1 trees may have had a different
role and different domain restrictions on each one. Representing that after
consolidation needs more than the single ``(role, restrictions)`` pair a
``WorkspaceMembership`` row holds, so a user's access here is the union of:

- at most one workspace-wide grant — their ``WorkspaceMembership`` row, the
  unscoped default every share used before this landed;
- any number of section-scoped grants — ``WorkspaceSectionGrant`` rows, one
  per ``(user, section)``.

Each is evaluated as a single, complete unit. Resolving "what can this user
do here" never takes the role from one grant and the restrictions from
another (see ``_best``). Enforcing this resolution against every read path
(neighborhood, search, exports, ...) behind one choke point is #984; this
module is the model and resolver it consumes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import InvalidInputError
from app.models import WorkspaceMembership, WorkspaceSectionGrant

_ROLE_RANK = {"viewer": 0, "editor": 1}
VALID_ROLES = frozenset(_ROLE_RANK)

# Sentinel distinguishing "leave restrictions unchanged" from "clear them"
# (None/[] are both valid, meaningful values) in update_section_grant below.
_UNSET = object()


@dataclass(frozen=True)
class Grant:
    """One applicable grant: a role and restriction set resolved together."""

    id: str
    # None = workspace-wide.
    section_id: str | None
    role: str
    restrictions: tuple[str, ...] = field(default_factory=tuple)


def user_grants(db: Session, workspace_id: str, user_id: str) -> list[Grant]:
    """Every grant this user holds in this workspace, unresolved.

    Does not account for ownership or admin god-mode — callers that need the
    coarse "does this user have access at all" answer go through
    ``app.services.workspace_roles.role_for`` first.
    """
    grants: list[Grant] = []
    membership = db.get(WorkspaceMembership, (workspace_id, user_id))
    if membership is not None:
        grants.append(
            Grant(
                id=f"membership:{workspace_id}:{user_id}",
                section_id=None,
                role=membership.role,
                restrictions=tuple(sorted(membership.restrictions or ())),
            )
        )
    section_grants = db.scalars(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == workspace_id,
            WorkspaceSectionGrant.user_id == user_id,
        )
    )
    grants.extend(
        Grant(
            id=g.id,
            section_id=g.section_id,
            role=g.role,
            restrictions=tuple(sorted(g.restrictions or ())),
        )
        for g in section_grants
    )
    return grants


def _applicable(grants: list[Grant], section_id: str | None) -> list[Grant]:
    """Grants that cover ``section_id``.

    A workspace-wide grant always applies. A section-scoped grant applies
    only to its own section — it never confers workspace-wide access, so
    asking for ``section_id=None`` (a workspace-wide action or piece of
    content) only ever matches a workspace-wide grant.
    """
    if section_id is None:
        return [g for g in grants if g.section_id is None]
    return [g for g in grants if g.section_id is None or g.section_id == section_id]


def _best(grants: list[Grant]) -> Grant | None:
    """The single grant to evaluate an action against.

    Never synthesizes permission by combining fields from two grants: when
    several apply, the one with the highest role wins as a whole (role *and*
    restrictions together); ties break on fewest restrictions, then on grant
    id, so the choice is deterministic and reproducible.
    """
    if not grants:
        return None
    return min(
        grants,
        key=lambda g: (-_ROLE_RANK.get(g.role, 0), len(g.restrictions), g.id),
    )


def effective_grant(
    db: Session, workspace_id: str, user_id: str, *, section_id: str | None = None
) -> Grant | None:
    """The single grant governing this user's access to ``section_id``
    (``None`` = a workspace-wide action or piece of content), or ``None``
    with no applicable grant.

    Does not special-case the owner or an admin; callers resolve those
    first (see ``app.services.workspace_roles.role_for``).
    """
    grants = user_grants(db, workspace_id, user_id)
    return _best(_applicable(grants, section_id))


def best_grant(db: Session, workspace_id: str, user_id: str) -> Grant | None:
    """The single highest-role grant among *all* of this user's grants,
    regardless of scope — role and restrictions from that one grant only.

    The coarse "can they get in the door, and with which restrictions"
    answer used by ``role_for`` and the workspace summary card. Which grant
    applies to a specific section/record is a finer question #984 answers.
    """
    grants = user_grants(db, workspace_id, user_id)
    if not grants:
        return None
    return max(grants, key=lambda g: _ROLE_RANK.get(g.role, 0))


def best_role(db: Session, workspace_id: str, user_id: str) -> str | None:
    grant = best_grant(db, workspace_id, user_id)
    return grant.role if grant is not None else None


def permitted_section_ids(
    db: Session, workspace_id: str, user_id: str
) -> set[str] | None:
    """Sections this user may *write* into, or ``None`` for unrestricted
    (an editor-level workspace-wide grant).

    Feeds ``app.services.provenance.resolve_origin_section``: a user with no
    editor-level workspace-wide grant can never have new content default to
    workspace-wide origin, only to a section they hold an *editor* grant in.
    A non-editor grant (workspace-wide or scoped) contributes nothing here —
    otherwise a workspace-wide viewer grant sitting alongside one section's
    editor grant would be misread as "no restriction", handing that editor
    write access to every other section too.
    """
    editor_grants = [
        g for g in user_grants(db, workspace_id, user_id) if g.role == "editor"
    ]
    if any(g.section_id is None for g in editor_grants):
        return None
    return {g.section_id for g in editor_grants}


def restricts_domain(db: Session, workspace_id: str, user_id: str, domain: str) -> bool:
    """True only when *every* grant this user holds restricts ``domain``.

    A coarse, workspace-level gate — mirroring ``best_role`` above, a
    collaborator unrestricted in at least one scope must not lose a domain
    everywhere just because a different scope restricts it. Fine per-section
    domain enforcement is #984's job.
    """
    grants = user_grants(db, workspace_id, user_id)
    if not grants:
        return False
    return all(domain in g.restrictions for g in grants)


# ---------------------------------------------------------------------------
# Section-grant management (used directly by migration/tests; no owner-facing
# route exists yet — richer section-sharing UX is a follow-up per #993/#980).
# ---------------------------------------------------------------------------


def create_section_grant(
    db: Session,
    *,
    workspace_id: str,
    section_id: str,
    user_id: str,
    role: str,
    restrictions: list[str] | None = None,
) -> WorkspaceSectionGrant:
    if role not in VALID_ROLES:
        raise InvalidInputError(f"Invalid role: {role}")
    grant = WorkspaceSectionGrant(
        workspace_id=workspace_id,
        section_id=section_id,
        user_id=user_id,
        role=role,
        restrictions=restrictions or None,
        access_version=0,
    )
    db.add(grant)
    return grant


def update_section_grant(
    grant: WorkspaceSectionGrant,
    *,
    role: str | None = None,
    restrictions: list[str] | None = _UNSET,
) -> WorkspaceSectionGrant:
    """Change a grant's role and/or restrictions.

    ``restrictions`` defaults to a sentinel (leave unchanged) so a caller can
    explicitly pass ``None``/``[]`` to clear it.
    """
    if role is not None:
        if role not in VALID_ROLES:
            raise InvalidInputError(f"Invalid role: {role}")
        grant.role = role
    if restrictions is not _UNSET:
        grant.restrictions = restrictions or None
    grant.access_version += 1
    return grant


def revoke_section_grant(db: Session, grant: WorkspaceSectionGrant) -> None:
    db.delete(grant)
