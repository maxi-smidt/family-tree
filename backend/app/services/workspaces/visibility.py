"""The single visibility resolver (#984).

Members, the neighborhood graph, and every content domain (events, stories,
documents, diseases, tasks, gallery) ask one ``WorkspaceAccessContext`` what
they may see or change, instead of each route inventing its own filter on
top of #993's grants and #1023's content provenance. Building the context is
the only place a principal's grants are turned into a resolved boundary;
every consumer below evaluates that same boundary rather than re-deriving
one.

Search, statistics, activity, export, media byte-serving, and SSE/presence
do not consume this yet. Section-scoped grants have no HTTP route to create
one (``app.services.workspaces.grants.create_section_grant`` is
service-layer only, by design — see #993), so those read surfaces have
nothing to leak until a follow-up wires grant management into the UI.
Search already has its own tracking issue (#1024); the rest should get the
same treatment before that UI ships.

Two visibility rules feed every method here:

- A member is visible to a scoped (non-unrestricted) caller only when it is
  assigned to one of their granted sections (``SectionMember``). An
  unassigned member is workspace-wide territory, not a default any scoped
  grant reaches.
- A content record (``ContentScope``) with no section (workspace-wide
  origin) is visible to anyone with *any* access to the workspace; a scoped
  record is visible only to a workspace-wide grant holder or a grant naming
  that section specifically. Mirrors ``app.services.provenance.scope_audience``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import AccessDeniedError, NotFoundError
from app.models import ContentScope, ContentType, Member, SectionMember, User, Workspace
from app.services.workspaces.grants import Grant, resolve_grant, user_grants
from app.services.workspaces.public_links import resolve_public_grant_for_read

PUBLIC_PRINCIPAL = "public"


@dataclass(frozen=True)
class WorkspaceAccessContext:
    """The resolved read/write boundary for one principal in one workspace."""

    workspace_id: str
    principal: str  # a user id, or PUBLIC_PRINCIPAL
    is_owner_or_admin: bool
    grants: tuple[Grant, ...] = field(default_factory=tuple)

    @property
    def unrestricted(self) -> bool:
        """Whole-workspace visibility: owner, admin, or a workspace-wide grant."""
        return self.is_owner_or_admin or any(g.section_id is None for g in self.grants)

    @property
    def scoped_section_ids(self) -> frozenset[str]:
        """Every section named by one of this principal's grants.

        Meaningless (and unused) once ``unrestricted`` is true — a
        workspace-wide grant already implies every section.
        """
        return frozenset(g.section_id for g in self.grants if g.section_id is not None)

    def visible_section_ids(self) -> frozenset[str] | None:
        """``None`` means every section (and unassigned content) is visible."""
        if self.unrestricted:
            return None
        return self.scoped_section_ids

    # -- read: sections/content -------------------------------------------

    def can_read_scope(self, section_id: str | None) -> bool:
        """Whether a record originating in ``section_id`` is visible.

        ``None`` (workspace-wide origin) is always visible to a resolved
        context — reaching this method at all means the principal has *some*
        access to the workspace.
        """
        if section_id is None or self.unrestricted:
            return True
        return section_id in self.scoped_section_ids

    def content_filter(
        self,
        content_type: ContentType,
        id_column: ColumnElement,
        *,
        domain: str | None = None,
    ) -> ColumnElement | None:
        """A WHERE clause selecting only rows of ``content_type`` this context
        may read.

        ``domain``, when given, additionally requires that the grant
        *governing each section* not restrict it — ``require_domain`` only
        checked this coarsely (denying the whole route if *every* grant
        restricts the domain); a caller who passes that gate can still hold
        one grant that restricts a domain and another, for a different
        section, that doesn't, and each section's content must honor its own
        governing grant rather than the caller's most permissive one.

        ``None`` means no filter is needed — the common case, and the only
        one before any section grant or domain restriction exists.
        """
        if self.is_owner_or_admin:
            return None

        grants = list(self.grants)

        def _reaches(section_id: str | None) -> bool:
            grant = resolve_grant(grants, section_id)
            return grant is not None and (
                domain is None or domain not in grant.restrictions
            )

        workspace_grant = resolve_grant(grants, None)
        if workspace_grant is not None and (
            domain is None or domain not in workspace_grant.restrictions
        ):
            # The workspace-wide grant doesn't restrict this domain — it
            # reaches every section, so nothing narrower is needed.
            return None

        conditions = []
        # Workspace-wide-origin content has no scoped grant governing it —
        # only a workspace-wide one could. With none at all it falls to the
        # base "visible to anyone with any access" rule (`can_read_scope`),
        # domain restriction and all; with one that restricts this domain
        # (the branch above didn't return), it stays hidden regardless of
        # what any *scoped* grant permits.
        if workspace_grant is None:
            conditions.append(ContentScope.section_id.is_(None))
        allowed_sections = {sid for sid in self.scoped_section_ids if _reaches(sid)}
        if allowed_sections:
            conditions.append(ContentScope.section_id.in_(allowed_sections))
        if not conditions:
            return id_column.in_(())
        return id_column.in_(
            select(ContentScope.content_id).where(
                ContentScope.content_type == str(content_type),
                or_(*conditions),
            )
        )

    def can_read_content_record(
        self, db: Session, content_type: ContentType, content_id: str
    ) -> bool:
        if self.unrestricted:
            return True
        scope = db.get(ContentScope, (str(content_type), content_id))
        return self.can_read_scope(scope.section_id if scope is not None else None)

    def require_read_content(
        self, db: Session, content_type: ContentType, content_id: str
    ) -> None:
        if not self.can_read_content_record(db, content_type, content_id):
            raise NotFoundError(f"{content_type.value.capitalize()} not found")

    # -- read: members -------------------------------------------------------

    def member_filter(self) -> ColumnElement | None:
        """A WHERE clause selecting only visible members. ``None`` = no filter."""
        if self.unrestricted:
            return None
        if not self.scoped_section_ids:
            return Member.id.in_(())
        return Member.id.in_(
            select(SectionMember.member_id).where(
                SectionMember.section_id.in_(self.scoped_section_ids)
            )
        )

    def member_section_ids(self, db: Session, member_id: str) -> set[str]:
        return set(
            db.scalars(
                select(SectionMember.section_id).where(
                    SectionMember.member_id == member_id
                )
            )
        )

    def can_read_member(self, db: Session, member_id: str) -> bool:
        if self.unrestricted:
            return True
        return bool(self.member_section_ids(db, member_id) & self.scoped_section_ids)

    def require_read_member(self, db: Session, member_id: str) -> None:
        if not self.can_read_member(db, member_id):
            raise NotFoundError("Member not found")

    # -- write ----------------------------------------------------------------

    def grant_for(self, section_id: str | None) -> Grant | None:
        if self.is_owner_or_admin:
            return None
        return resolve_grant(list(self.grants), section_id)

    def can_write_scope(
        self, section_id: str | None, *, domain: str | None = None
    ) -> bool:
        if self.is_owner_or_admin:
            return True
        grant = self.grant_for(section_id)
        if grant is None or grant.role != "editor":
            return False
        return domain is None or domain not in grant.restrictions

    def require_write_scope(
        self, section_id: str | None, *, domain: str | None = None
    ) -> None:
        if not self.can_write_scope(section_id, domain=domain):
            raise AccessDeniedError("Read-only access to this section")

    def require_write_content(
        self,
        db: Session,
        content_type: ContentType,
        content_id: str,
        *,
        domain: str | None = None,
    ) -> ContentScope | None:
        """Load ``content_id``'s scope, 404 if unreadable, 403 if unwritable."""
        scope = db.get(ContentScope, (str(content_type), content_id))
        section_id = scope.section_id if scope is not None else None
        if not self.can_read_scope(section_id):
            raise NotFoundError(f"{content_type.value.capitalize()} not found")
        self.require_write_scope(section_id, domain=domain)
        return scope

    def can_write_member(
        self, db: Session, member_id: str, *, mode: Literal["edit", "delete"] = "edit"
    ) -> bool:
        """Whether this context may change ``member_id``.

        ``edit``: any editor grant reaching one of the member's sections is
        enough — the canonical record changes in every section it belongs
        to, readable or not. ``delete``/merge is stricter: it removes the
        record from every section at once, so it requires an editor grant
        (or ownership) covering *all* of them.
        """
        if self.is_owner_or_admin or self.can_write_scope(None):
            return True
        sections = self.member_section_ids(db, member_id)
        if not sections:
            return False
        if mode == "edit":
            return any(self.can_write_scope(sid) for sid in sections)
        return all(self.can_write_scope(sid) for sid in sections)

    def require_write_member(
        self, db: Session, member_id: str, *, mode: Literal["edit", "delete"] = "edit"
    ) -> None:
        if not self.can_read_member(db, member_id):
            raise NotFoundError("Member not found")
        if not self.can_write_member(db, member_id, mode=mode):
            raise AccessDeniedError("Read-only access to this member's scope")

    # -- fingerprint ------------------------------------------------------

    def fingerprint_parts(self) -> tuple[object, ...]:
        """Everything that must invalidate a cursor/cache entry when it changes."""
        return (
            self.principal,
            self.is_owner_or_admin,
            tuple(
                sorted(
                    (g.id, g.section_id or "", g.role, ",".join(g.restrictions))
                    for g in self.grants
                )
            ),
        )


def resolve_access_context(
    db: Session,
    tree: Workspace,
    user: User | None,
    *,
    public_token: str | None = None,
) -> WorkspaceAccessContext:
    """Build the ``WorkspaceAccessContext`` for one request.

    Assumes the caller already passed the coarse read/write gate in
    ``app.api.deps`` — this only resolves *which* records that access
    reaches, never whether access exists at all.
    """
    if user is not None:
        if user.is_admin or user.id == tree.owner_id:
            return WorkspaceAccessContext(tree.id, user.id, True)
        grants = tuple(user_grants(db, tree.id, user.id))
        if grants:
            return WorkspaceAccessContext(tree.id, user.id, False, grants)
        # No explicit membership or grant at all: the coarse gate
        # (`app.api.deps._resolve_workspace`'s ``role is None`` branch) can
        # still have admitted this authenticated user through a public
        # grant, exactly as it would an anonymous caller — fall through and
        # resolve that grant instead of returning an empty, all-denying
        # context for someone the gate already let in.

    principal = user.id if user is not None else PUBLIC_PRINCIPAL
    grant = resolve_public_grant_for_read(db, tree, public_token)
    if grant is None:
        # The coarse gate should already have rejected this request; resolve
        # to no access rather than raising from inside a read-side helper.
        return WorkspaceAccessContext(tree.id, principal, False)
    if grant.section_id is None:
        return WorkspaceAccessContext(tree.id, principal, True)
    public_grant = Grant(
        id=f"public:{grant.id}", section_id=grant.section_id, role="viewer"
    )
    return WorkspaceAccessContext(tree.id, principal, False, (public_grant,))
